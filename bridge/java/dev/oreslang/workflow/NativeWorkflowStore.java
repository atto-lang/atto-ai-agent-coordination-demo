package dev.oreslang.workflow;

import java.nio.file.Path;
import java.util.Objects;

/** JNI host adapter around the C++ wf_* SQLite ABI. Not a guest-language FFI.
 * The caller is a trusted host controller; untrusted actors must never choose
 * Policy or obtain raw native handles. No critical Oreslang loan crosses I/O.
 */
public final class NativeWorkflowStore implements AutoCloseable {
    public static final int OK=0, FENCED=1, DUPLICATE=2, UNAUTHORIZED=3,
        INVALID=4, STORAGE_ERROR=5, UNKNOWN=6;

    public record Call(String action, String tenant, String run, String revision,
        long epoch, long version, String step, String effectKey,
        String digest, String messageId, String outcome, String receipt) {}
    public record Receipt(String tenant, String run, String revision,
        String step, String effectKey, String digest, String outcome, String receipt) {}
    public interface Policy {
        boolean authorize(Call call);
        boolean verifyReceipt(Receipt receipt);

        /** JNI entrypoint; indices are fixed by bridge/jni/workflow_jni.cpp. */
        default boolean authorizeNative(String[] fields, long epoch, long version) {
            if (fields == null || fields.length != 10) return false;
            return authorize(new Call(fields[0],fields[1],fields[2],fields[3],
                epoch,version,fields[4],fields[5],fields[6],fields[7],fields[8],fields[9]));
        }
        default boolean verifyNative(String[] fields) {
            if (fields == null || fields.length != 10) return false;
            return verifyReceipt(new Receipt(fields[1],fields[2],fields[3],
                fields[4],fields[5],fields[6],fields[8],fields[9]));
        }
    }
    public static final class StorageException extends IllegalStateException {
        public final int status;
        public StorageException(String operation, int status) {
            super(operation + " returned native WF_* status " + status);
            this.status = status;
        }
    }
    public record Lease(long epoch,long version) {}
    public record Snapshot(long epoch,long version,long prepared,long inDoubt,
                           long committed,long notApplied,long inboxCount) {}

    static { System.loadLibrary("ores_workflow_jni"); }
    private long handle;
    private NativeWorkflowStore(long h) { this.handle=h; }
    public static NativeWorkflowStore open(Path directory, Policy policy) {
        Objects.requireNonNull(directory,"directory");
        Objects.requireNonNull(policy,"trusted policy");
        long h=nativeOpen(directory.toAbsolutePath().normalize().toString(),policy);
        if(h == 0) throw new StorageException("wf_open",STORAGE_ERROR);
        return new NativeWorkflowStore(h);
    }
    private long active() {
        if (handle==0) throw new IllegalStateException("workflow storage already closed");
        return handle;
    }
    private static void checked(String action,int status) {
        if(status!=OK) throw new StorageException(action,status);
    }
    public synchronized void createRun(String tenant,String run,String revision) {
        checked("wf_create_run",nativeCreateRun(active(),tenant,run,revision));
    }
    public synchronized Lease activate(String tenant,String run,String revision,long expectedEpoch) {
        long[] result=nativeActivate(active(),tenant,run,revision,expectedEpoch);
        checked("wf_activate",(int)result[0]);return new Lease(result[1],result[2]);
    }
    public synchronized long acceptStep(String tenant,String run,String revision,
        long epoch,long version,String step,String messageId,String effectKey,String digest) {
        long[] result=nativeAcceptStep(active(),tenant,run,revision,epoch,version,
            step,messageId,effectKey,digest);
        checked("wf_accept_step",(int)result[0]);return result[1];
    }
    public synchronized long claimDispatch(String tenant,String run,String revision,
        long epoch,long version,String step,String effectKey,String digest) {
        long[] result=nativeClaimDispatch(active(),tenant,run,revision,epoch,version,step,effectKey,digest);
        checked("wf_claim_dispatch",(int)result[0]);return result[1];
    }
    public synchronized long reconcile(String tenant,String run,String revision,
        long epoch,long version,String step,String outcome,String receipt) {
        long[] result=nativeReconcile(active(),tenant,run,revision,epoch,version,step,outcome,receipt);
        checked("wf_reconcile",(int)result[0]);return result[1];
    }
    public synchronized long finish(String tenant,String run,String revision,long epoch,long version) {
        long[] result=nativeFinish(active(),tenant,run,revision,epoch,version);
        checked("wf_finish",(int)result[0]);return result[1];
    }
    public synchronized Snapshot inspect(String tenant,String run,String revision) {
        long[] result=nativeInspect(active(),tenant,run,revision);
        checked("wf_inspect",(int)result[0]);
        return new Snapshot(result[1],result[2],result[3],result[4],result[5],result[6],result[7]);
    }
    @Override public synchronized void close() {
        long h=handle;handle=0;
        if(h!=0) nativeClose(h);
    }
    private static native long nativeOpen(String directory,Policy policy);
    private static native void nativeClose(long handle);
    private static native int nativeCreateRun(long handle,String tenant,String run,String revision);
    private static native long[] nativeActivate(long handle,String tenant,String run,String revision,long expectedEpoch);
    private static native long[] nativeAcceptStep(long handle,String tenant,String run,String revision,
        long epoch,long version,String step,String messageId,String effectKey,String digest);
    private static native long[] nativeClaimDispatch(long handle,String tenant,String run,String revision,
        long epoch,long version,String step,String effectKey,String digest);
    private static native long[] nativeReconcile(long handle,String tenant,String run,String revision,
        long epoch,long version,String step,String outcome,String receipt);
    private static native long[] nativeFinish(long handle,String tenant,String run,String revision,
        long epoch,long version);
    private static native long[] nativeInspect(long handle,String tenant,String run,String revision);
}
