package dev.oreslang.workflow;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Base64;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.CountDownLatch;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import static dev.oreslang.workflow.NativeWorkflowStore.*;
import static dev.oreslang.workflow.WorkflowStorageMailbox.*;

/** Real host mailbox -> JNI -> SQLite tests. NOT a .ores guest test. */
public final class WorkflowStorageMailboxTest {
    private static final String TENANT="tenant-a",RUN="run-1",STEP="step-1";
    private static final String SHA="a".repeat(40), DIGEST="b".repeat(64);
    private static final String KEY="key-1", RECEIPT="receipt-1";
    private static final byte[] TEST_SECRET = new byte[32];
    private static final AtomicLong GENERATION=new AtomicLong(1);
    static { java.util.Arrays.fill(TEST_SECRET, (byte)0x47); }
    private static int tests;
    private static void check(boolean ok,String msg) {if(!ok) throw new AssertionError(msg);}
    private static String payload(Message m) {
        return String.join("|",m.requestId(),m.action().name(),m.tenant(),m.run(),
            m.revision(),String.valueOf(m.generation()),String.valueOf(m.epoch()),
            String.valueOf(m.version()),m.step(),m.messageId(),m.effectKey(),
            m.digest(),m.outcome(),m.receipt());
    }
    private static String signature(Message m){
        try {
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(TEST_SECRET,"HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(
                    mac.doFinal(payload(m).getBytes(StandardCharsets.UTF_8)));
        } catch(Exception error){throw new IllegalStateException(error);}
    }
    private static boolean admit(Message m,long now) {
        return m.generation()==GENERATION.get() && m.capability().startsWith("test:") &&
           java.security.MessageDigest.isEqual(signature(m).getBytes(StandardCharsets.US_ASCII),
                    m.capability().substring(5).getBytes(StandardCharsets.US_ASCII));
    }
    private static Message request(String id, Action action,long epoch,long version,
                    String step,String message,String key,String digest,String outcome,String receipt) {
        Message unsealed=new Message(id,"test:unset",action,TENANT,RUN,SHA,
                GENERATION.get(),epoch,version,step,message,key,digest,outcome,receipt);
        return new Message(id,"test:"+signature(unsealed),action,TENANT,RUN,SHA,
                unsealed.generation(),epoch,version,step,message,key,digest,outcome,receipt);
    }
    private static Message req(String id,Action action,long epoch,long version) {
        return request(id,action,epoch,version,"","","","","","");
    }
    private static Reply send(WorkflowStorageMailbox service,Message m) throws Exception {
        return service.submit(m).get(8,TimeUnit.SECONDS);
    }
    private static Reply success(WorkflowStorageMailbox s,Message m) throws Exception {
        Reply r=send(s,m);check(r.succeeded(),"expected OK for "+m.action()+" but "+r.status()+"/"+r.nativeStatus());return r;
    }
    private static WorkflowStorageMailbox open(Path path,Path remote) {
        return new WorkflowStorageMailbox(NativeWorkflowStore.open(path,
                new NativeWorkflowBridgeTest.HostPolicy(remote)),WorkflowStorageMailboxTest::admit,4);
    }
    private static void admissionAndRelease() throws Exception {
        Path dir=Files.createTempDirectory("ores-mailbox-"),remote=dir.resolve("provider.txt");
        try(NativeWorkflowStore bootstrap=NativeWorkflowStore.open(dir,
                new NativeWorkflowBridgeTest.HostPolicy(remote))) {bootstrap.createRun(TENANT,RUN,SHA);}
        WorkflowStorageMailbox service=open(dir,remote);
        try {
            Reply activated=success(service,req("act-1",Action.ACTIVATE,0,0));
            check(activated.epoch()==1 && activated.version()==1,"activation");
            Message valid=request("admit-1",Action.ACCEPT_STEP,1,1,STEP,"message-1",KEY,DIGEST,"","");
            Message tampered=new Message(valid.requestId(),valid.capability(),valid.action(),"tenant-b",
                    valid.run(),valid.revision(),valid.generation(),valid.epoch(),valid.version(),
                    valid.step(),valid.messageId(),valid.effectKey(),valid.digest(),valid.outcome(),valid.receipt());
            check(send(service,tampered).status()==Status.DENIED,"tenant spoofing");
            check(send(service,new Message("broken","anything",Action.ACCEPT_STEP,TENANT,RUN,SHA,
                    1,1,1,STEP,"../../oops",KEY,DIGEST,"","")).status()==Status.BAD_MESSAGE,
                    "invalid inbox fields");
            check(send(service,new Message("missing","",Action.INSPECT,TENANT,RUN,SHA,
                    1,1,1,"","","","","","")).status()==Status.BAD_MESSAGE,"empty capability");
            Reply accepted=success(service,valid);
            check(accepted.version()==2,"durable admission version");
            Message claim=request("claim-1",Action.CLAIM_DISPATCH,1,2,STEP,"",KEY,DIGEST,"","");
            Reply claimed=success(service,claim);
            check(claimed.version()==3,"durable claim version");
            check(send(service,claim).status()==Status.NATIVE_ERROR,"duplicate claim rejected");
            check(send(service,req("inspect-1",Action.INSPECT,1,3)).inDoubt()==1,"in-doubt exposed as scalar");
            // No remote receipt; trusted C++ receipt verification must fail closed.
            Message receipt=request("settle-1",Action.RECONCILE,1,3,STEP,"","","","committed",RECEIPT);
            check(send(service,receipt).status()==Status.NATIVE_ERROR,"unverified receipt");
            Files.writeString(remote,KEY+"|"+DIGEST+"|"+RECEIPT,
                    StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
            Reply settled=success(service,receipt);
            check(settled.version()==4,"receipt version");
            success(service,req("finish-1",Action.FINISH,1,4));
            check(send(service,req("inspect-2",Action.INSPECT,1,5)).committed()==1,"finished effect");
        } finally {service.close();}
        check(send(service,req("closed-1",Action.INSPECT,1,5)).status()==Status.CLOSED,"service close");
        tests++;
    }
    private static void noGuestAuthority() throws Exception {
        Path dir=Files.createTempDirectory("ores-mailbox-denied-"),remote=dir.resolve("provider.txt");
        try(NativeWorkflowStore store=NativeWorkflowStore.open(dir,
                new NativeWorkflowBridgeTest.HostPolicy(remote))) {store.createRun(TENANT,RUN,SHA);}
        try(WorkflowStorageMailbox service=open(dir,remote)) {
            Message old=req("expired-gen",Action.ACTIVATE,0,0);
            GENERATION.incrementAndGet();
            check(send(service,old).status()==Status.DENIED,"stale generation blocked");
            GENERATION.decrementAndGet();
            Reply r=success(service,req("fresh",Action.ACTIVATE,0,0));
            check(r.epoch()==1,"fresh authority");
        }
        tests++;
    }
    private static void boundedHostWorker() throws Exception {
        Path dir=Files.createTempDirectory("ores-mailbox-backpressure-"),remote=dir.resolve("provider.txt");
        try(NativeWorkflowStore bootstrap=NativeWorkflowStore.open(dir,
                new NativeWorkflowBridgeTest.HostPolicy(remote))) {bootstrap.createRun(TENANT,RUN,SHA);}
        CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);
        AtomicInteger onWorker=new AtomicInteger();
        WorkflowStorageMailbox service=new WorkflowStorageMailbox(
                NativeWorkflowStore.open(dir,new NativeWorkflowBridgeTest.HostPolicy(remote)),
                (m,now)->{
                    if(Thread.currentThread().getName().contains("ores-workflow-storage-host")) onWorker.incrementAndGet();
                    started.countDown();
                    try {return release.await(3,TimeUnit.SECONDS) && admit(m,now);}
                    catch(InterruptedException e){Thread.currentThread().interrupt();return false;}
                },1);
        try {
            var first=service.submit(req("blocked",Action.ACTIVATE,0,0));
            check(started.await(3,TimeUnit.SECONDS),"host worker starts");
            check(send(service,req("overflow",Action.INSPECT,0,0)).status()==Status.OVERLOADED,
                    "bounded admission rejects overloaded actor messages");
            release.countDown();
            check(first.get(5,TimeUnit.SECONDS).succeeded(),"first request eventually succeeds");
            check(onWorker.get()==1,"never call admission on guest/caller thread");
        } finally {release.countDown();service.close();}
        tests++;
    }
    private static void child(Path dir,Path remote) throws Exception {
        try(NativeWorkflowStore bootstrap=NativeWorkflowStore.open(dir,
                new NativeWorkflowBridgeTest.HostPolicy(remote))) {bootstrap.createRun(TENANT,RUN,SHA);}
        try(WorkflowStorageMailbox s=open(dir,remote)) {
            success(s,req("child-act",Action.ACTIVATE,0,0));
            success(s,request("child-admit",Action.ACCEPT_STEP,1,1,STEP,"message-1",KEY,DIGEST,"",""));
            success(s,request("child-claim",Action.CLAIM_DISPATCH,1,2,STEP,"",KEY,DIGEST,"",""));
        }
        // External effect commits, then process is killed before local ACK.
        Files.writeString(remote,KEY+"|"+DIGEST+"|"+RECEIPT,
                    StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
        try(var fd=java.nio.channels.FileChannel.open(remote,StandardOpenOption.WRITE)) {fd.force(true);}
        ProcessHandle.current().destroyForcibly();
        throw new AssertionError("child must not return from kill");
    }
    private static void killedProcessRecovery() throws Exception {
        Path dir=Files.createTempDirectory("ores-mailbox-kill-"),remote=dir.resolve("provider.txt");
        String java=Path.of(System.getProperty("java.home"),"bin","java").toString();
        Process child=new ProcessBuilder(java,"-Djava.library.path="+System.getProperty("java.library.path"),
                "-cp",System.getProperty("java.class.path"),WorkflowStorageMailboxTest.class.getName(),
                "child",dir.toString(),remote.toString()).redirectErrorStream(true).start();
        boolean done=child.waitFor(8,TimeUnit.SECONDS);
        if(!done) {child.destroyForcibly();throw new AssertionError("child timeout");}
        check(child.exitValue()!=0,"child must exit nonzero");
        String original=Files.readString(remote);
        try(WorkflowStorageMailbox service=open(dir,remote)) {
            Reply snapshot=success(service,req("pre-restart",Action.INSPECT,1,3));
            check(snapshot.inDoubt()==1,"persisted claim");
            Reply activated=success(service,req("new-act",Action.ACTIVATE,1,3));
            check(activated.epoch()==2 && activated.version()==4,"new durable epoch");
            Message repeat=request("duplicate",Action.CLAIM_DISPATCH,2,4,STEP,"",KEY,DIGEST,"","");
            check(send(service,repeat).status()==Status.NATIVE_ERROR,"no re-dispatch after kill");
            Reply settled=success(service,request("reconcile",Action.RECONCILE,2,4,
                    STEP,"","","","committed",RECEIPT));
            check(settled.version()==5,"reconciled version");
            success(service,req("finish",Action.FINISH,2,5));
            check(success(service,req("end",Action.INSPECT,2,6)).committed()==1,"effect committed");
        }
        check(Files.readString(remote).equals(original),"remote effect not repeated");
        tests++;
    }
    private static void timedOutCloseCanBeRetried() throws Exception {
        Path dir=Files.createTempDirectory("ores-mailbox-close-retry-"),remote=dir.resolve("provider.txt");
        NativeWorkflowStore store=NativeWorkflowStore.open(dir,
                new NativeWorkflowBridgeTest.HostPolicy(remote));
        store.createRun(TENANT,RUN,SHA);
        CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);
        WorkflowStorageMailbox service=new WorkflowStorageMailbox(store,(m,now)->{
            started.countDown();
            try {return release.await(12,TimeUnit.SECONDS);}
            catch(InterruptedException e){Thread.currentThread().interrupt();return false;}
        },1);
        try {
            var task=service.submit(req("slow-close",Action.INSPECT,0,0));
            check(started.await(3,TimeUnit.SECONDS),"host worker entered slow admission");
            boolean retained=false;
            try {service.close();}
            catch(IllegalStateException e) {
                retained=e.getMessage().contains("worker is still busy");
            }
            check(retained,"first close times out without closing active JNI handle");
            check(send(service,req("after-close",Action.INSPECT,0,0)).status()==Status.CLOSED,
                    "timed-out close must never reopen guest admission");
            release.countDown();
            check(task.get(5,TimeUnit.SECONDS).succeeded(),"original host operation completes");
            service.close();
            boolean handleReleased=false;
            try {store.inspect(TENANT,RUN,SHA);}
            catch(IllegalStateException e) {
                handleReleased=e.getMessage().contains("already closed");
            }
            check(handleReleased,"retry must release JNI storage after worker termination");
        } finally {release.countDown();service.close();}
        tests++;
    }
    public static void main(String[] args) throws Exception {
        if(args.length==3 && "child".equals(args[0])) {child(Path.of(args[1]),Path.of(args[2]));return;}
        admissionAndRelease();noGuestAuthority();boundedHostWorker();killedProcessRecovery();timedOutCloseCanBeRetried();
        System.out.println("WORKFLOW_MAILBOX_RESULT passed="+tests+" host_only=true");
    }
}
