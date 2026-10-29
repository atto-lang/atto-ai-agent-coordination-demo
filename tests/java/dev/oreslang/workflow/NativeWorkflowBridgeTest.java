package dev.oreslang.workflow;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static dev.oreslang.workflow.NativeWorkflowStore.*;

/** Real JDK21+ JNI-to-C++-to-SQLite checks. External provider is a FILE FIXTURE. */
public final class NativeWorkflowBridgeTest {
    static final String TENANT="tenant-a", RUN="run-1", STEP="step-1";
    static final String SHA="a".repeat(40), DIGEST="b".repeat(64),KEY="key-1",RECEIPT="receipt-1";
    static int tests=0;
    static void check(boolean ok,String description) {
        if(!ok) throw new AssertionError(description);
    }
    static void expect(int expected,Runnable fn) {
        try {fn.run();throw new AssertionError("expected native WF_*="+expected);}
        catch(StorageException e) {check(e.status==expected,"expected "+expected+" but got "+e.status);}
    }
    static class HostPolicy implements Policy {
        final Path remote;
        final AtomicInteger verificationCalls=new AtomicInteger();
        volatile boolean reject=false, throwInAuth=false;
        HostPolicy(Path receiptFile){remote=receiptFile;}
        @Override public boolean authorize(Call c) {
            if(throwInAuth) throw new SecurityException("deliberate verifier failure");
            return !reject && TENANT.equals(c.tenant()) && RUN.equals(c.run()) && SHA.equals(c.revision()) &&
                (c.step()==null || STEP.equals(c.step())) &&
                (c.effectKey()==null || KEY.equals(c.effectKey())) &&
                (c.digest()==null || DIGEST.equals(c.digest())) &&
                (c.messageId()==null || "message-1".equals(c.messageId())) &&
                (c.outcome()==null || "committed".equals(c.outcome())) &&
                (c.receipt()==null || RECEIPT.equals(c.receipt()));
        }
        @Override public boolean verifyReceipt(Receipt c) {
            verificationCalls.incrementAndGet();
            try {return TENANT.equals(c.tenant()) && RUN.equals(c.run()) && SHA.equals(c.revision()) &&
                STEP.equals(c.step()) && KEY.equals(c.effectKey()) && DIGEST.equals(c.digest()) &&
                "committed".equals(c.outcome()) && RECEIPT.equals(c.receipt()) &&
                Files.readString(remote).equals(KEY+"|"+DIGEST+"|"+RECEIPT);}
            catch(Exception ignored){return false;}
        }
    }
    static Lease initialize(NativeWorkflowStore db) {
        db.createRun(TENANT,RUN,SHA);
        return db.activate(TENANT,RUN,SHA,0);
    }
    static long claim(NativeWorkflowStore db,Lease lease) {
        long v=db.acceptStep(TENANT,RUN,SHA,lease.epoch(),lease.version(),
                STEP,"message-1",KEY,DIGEST);
        return db.claimDispatch(TENANT,RUN,SHA,lease.epoch(),v,STEP,KEY,DIGEST);
    }
    static void testJavaAbiAndPolicy() throws Exception {
        Path dir=Files.createTempDirectory("ores-jni-policy-");
        Path remote=dir.resolve("not-yet-created");
        HostPolicy policy=new HostPolicy(remote);
        try(NativeWorkflowStore db=NativeWorkflowStore.open(dir,policy)) {
            Lease lease=initialize(db);
            check(lease.epoch()==1 && lease.version()==1,"first epoch");
            expect(DUPLICATE,()->db.createRun(TENANT,RUN,SHA));
            expect(FENCED,()->db.activate(TENANT,RUN,SHA,0));
            long v=db.acceptStep(TENANT,RUN,SHA,lease.epoch(),lease.version(),
                STEP,"message-1",KEY,DIGEST);
            check(db.inspect(TENANT,RUN,SHA).prepared()==1,"prepared outbox");
            expect(DUPLICATE,()->db.acceptStep(TENANT,RUN,SHA,lease.epoch(),v,
                STEP,"message-1",KEY,DIGEST));
            policy.reject=true;
            expect(UNAUTHORIZED,()->db.claimDispatch(TENANT,RUN,SHA,lease.epoch(),v,STEP,KEY,DIGEST));
            expect(UNAUTHORIZED,()->db.inspect(TENANT,RUN,SHA));
            policy.reject=false;policy.throwInAuth=true;
            expect(UNAUTHORIZED,()->db.inspect(TENANT,RUN,SHA));
            policy.throwInAuth=false;
            long claimed=db.claimDispatch(TENANT,RUN,SHA,lease.epoch(),v,STEP,KEY,DIGEST);
            check(db.inspect(TENANT,RUN,SHA).inDoubt()==1,"in_doubt");
            expect(FENCED,()->db.claimDispatch(TENANT,RUN,SHA,lease.epoch(),claimed,STEP,KEY,DIGEST));
            expect(UNAUTHORIZED,()->db.reconcile(TENANT,RUN,SHA,lease.epoch(),claimed,
                 STEP,"committed",RECEIPT));
            check(db.inspect(TENANT,RUN,SHA).inDoubt()==1,"unverified receipt cannot settle");
            expect(INVALID,()->db.acceptStep(TENANT,RUN,SHA,lease.epoch(),claimed,
                 STEP,"bad/slash",KEY,DIGEST));
        }
        tests++;
        // Closed handles must throw in Java before JNI dereferences native memory.
        NativeWorkflowStore closed=NativeWorkflowStore.open(dir,policy);
        closed.close();closed.close();
        try{closed.inspect(TENANT,RUN,SHA);throw new AssertionError("use after close");}
        catch(IllegalStateException expected){check(!(expected instanceof StorageException),"closed handle rejected in Java");}
        tests++;
    }
    static Process startChild(String mode,Path dir,Path remote) throws Exception {
        String java=Path.of(System.getProperty("java.home"),"bin","java").toString();
        ProcessBuilder pb=new ProcessBuilder(java,
            "-Djava.library.path="+System.getProperty("java.library.path"),
            "-cp",System.getProperty("java.class.path"),
            NativeWorkflowBridgeTest.class.getName(),"child",mode,dir.toString(),remote.toString());
        pb.redirectErrorStream(true);
        Process process=pb.start();
        // Read only the child's ready marker, then force a real OS-level kill.
        BufferedReader reader=new BufferedReader(new InputStreamReader(process.getInputStream()));
        String marker=reader.readLine();
        check("CLAIM_DURABLE".equals(marker) || "REMOTE_COMMITTED".equals(marker),
             "unexpected child output: "+marker);
        check(("before".equals(mode)?"CLAIM_DURABLE":"REMOTE_COMMITTED").equals(marker),
             "wrong subprocess phase");
        process.destroyForcibly();
        check(process.waitFor(10,TimeUnit.SECONDS),"child terminated");
        check(process.exitValue()!=0,"must not exit successfully");
        return process;
    }
    static void testKill(boolean afterRemote) throws Exception {
        Path dir=Files.createTempDirectory("ores-jni-crash-");
        Path remote=dir.resolve("provider-fixture.receipt");
        startChild(afterRemote?"after":"before",dir,remote);
        check(Files.exists(remote)==afterRemote,"effect happened only in after mode");
        HostPolicy policy=new HostPolicy(remote);
        try(NativeWorkflowStore db=NativeWorkflowStore.open(dir,policy)) {
            Snapshot s=db.inspect(TENANT,RUN,SHA);
            check(s.inDoubt()==1 && s.inboxCount()==1,"persisted in-doubt after SIGKILL");
            Lease next=db.activate(TENANT,RUN,SHA,s.epoch());
            expect(FENCED,()->db.claimDispatch(TENANT,RUN,SHA,next.epoch(),next.version(),STEP,KEY,DIGEST));
            if(!afterRemote) {
                expect(UNAUTHORIZED,()->db.reconcile(TENANT,RUN,SHA,next.epoch(),next.version(),
                    STEP,"committed",RECEIPT));
            }
            if(afterRemote) {
                // File-backed test oracle is not a real signed provider.
                long v=db.reconcile(TENANT,RUN,SHA,next.epoch(),next.version(),
                    STEP,"committed",RECEIPT);
                check(db.inspect(TENANT,RUN,SHA).committed()==1,"receipt settled");
                long finalVersion=db.finish(TENANT,RUN,SHA,next.epoch(),v);
                check(finalVersion==v+1,"finished");
                check(Files.readString(remote).equals(KEY+"|"+DIGEST+"|"+RECEIPT),"remote effect not replayed");
            } else {
                check(db.inspect(TENANT,RUN,SHA).inDoubt()==1,"unproven remains frozen");
            }
        }
        tests++;
    }
    static void child(String mode,Path dir,Path remote) throws Exception {
        HostPolicy policy=new HostPolicy(remote);
        try(NativeWorkflowStore db=NativeWorkflowStore.open(dir,policy)) {
            Lease lease=initialize(db);
            claim(db,lease);
            if("after".equals(mode)) {
                Files.writeString(remote,KEY+"|"+DIGEST+"|"+RECEIPT,
                    StandardOpenOption.CREATE_NEW,StandardOpenOption.SYNC);
            }
            System.out.println("after".equals(mode)?"REMOTE_COMMITTED":"CLAIM_DURABLE");
            System.out.flush();
            Thread.sleep(60_000);
        }
    }
    public static void main(String[] args) throws Exception {
        if(args.length==4 && "child".equals(args[0])){
            child(args[1],Path.of(args[2]),Path.of(args[3]));return;
        }
        testJavaAbiAndPolicy();
        testKill(false);
        testKill(true);
        System.out.println("JNI_WORKFLOW_BRIDGE_RESULT passed="+tests+" native_library=ores_workflow_jni");
    }
}
