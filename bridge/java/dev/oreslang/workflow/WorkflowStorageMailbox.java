package dev.oreslang.workflow;

import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * HOST-OWNED mailbox service for workflow persistence. This is NOT a guest
 * binding: guest messages must be copied/decoded by a trusted runtime bridge.
 * A message never contains a JNI pointer, path, policy, or Java object handle.
 * All authorization, native storage I/O, and receipt validation run on a
 * dedicated host worker, never within a guest actor critical-state loan.
 */
public final class WorkflowStorageMailbox implements AutoCloseable {
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,96}");
    private static final Pattern SHA = Pattern.compile("[a-f0-9]{40}");
    private static final Pattern DIGEST = Pattern.compile("[a-f0-9]{64}");
    private static final Pattern RECEIPT = Pattern.compile("[A-Za-z0-9_.:-]{1,160}");

    public enum Action { ACTIVATE, ACCEPT_STEP, CLAIM_DISPATCH, RECONCILE, FINISH, INSPECT }
    public enum Status { OK, DENIED, BAD_MESSAGE, OVERLOADED, CLOSED, NATIVE_ERROR }

    /** All fields immutable. Empty strings are legal only for unused fields. */
    public record Message(String requestId, String capability, Action action,
            String tenant, String run, String revision, long generation,
            long epoch, long version, String step, String messageId,
            String effectKey, String digest, String outcome, String receipt) { }

    /** Detached scalar result; never contains a native handle or a policy. */
    public record Reply(String requestId, Status status, int nativeStatus,
            long epoch, long version, long prepared, long inDoubt,
            long committed, long notApplied, long inboxCount) {
        public boolean succeeded() { return status == Status.OK; }
    }

    /**
     * Trusted control plane checks full scope, issuer signature, expiry,
     * generation, revocation and operation. A plain string is NOT authority.
     * This verifier MUST NOT be implemented by guest/actor code.
     */
    @FunctionalInterface public interface Admission {
        boolean authorize(Message message, long nowMillis);
    }

    private final NativeWorkflowStore storage;
    private final Admission admission;
    private final ThreadPoolExecutor worker;
    private final Semaphore slots;
    private final AtomicBoolean closed = new AtomicBoolean();
    // Only set after the JNI handle is actually closed. A timed-out close
    // must remain retryable without reopening admission.
    private boolean handleClosed;

    public WorkflowStorageMailbox(NativeWorkflowStore storage,
            Admission trustedAdmission, int maxOutstanding) {
        this.storage = Objects.requireNonNull(storage, "trusted native storage");
        this.admission = Objects.requireNonNull(trustedAdmission, "trusted admission");
        if (maxOutstanding < 1 || maxOutstanding > 1024) {
            throw new IllegalArgumentException("outstanding limit must be 1..1024");
        }
        slots = new Semaphore(maxOutstanding);
        worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(maxOutstanding), task -> {
                    Thread t = new Thread(task, "ores-workflow-storage-host");
                    t.setDaemon(true);
                    return t;
                }, new ThreadPoolExecutor.AbortPolicy());
    }

    /** Never run storage or the admission callback on the caller's thread. */
    public CompletableFuture<Reply> submit(Message message) {
        String id = message == null ? "" : message.requestId();
        if (closed.get()) return CompletableFuture.completedFuture(fail(id, Status.CLOSED));
        if (!valid(message)) return CompletableFuture.completedFuture(fail(id, Status.BAD_MESSAGE));
        if (!slots.tryAcquire()) return CompletableFuture.completedFuture(fail(id, Status.OVERLOADED));
        CompletableFuture<Reply> result = new CompletableFuture<>();
        try {
            worker.execute(() -> {
                try {
                    if (closed.get()) result.complete(fail(message.requestId(), Status.CLOSED));
                    else if (!admission.authorize(message, System.currentTimeMillis())) {
                        result.complete(fail(message.requestId(), Status.DENIED));
                    } else result.complete(dispatch(message));
                } catch (Throwable failure) {
                    // Host errors/authorization exceptions are NEVER reflected
                    // into guest-facing replies or interpreted as success.
                    result.complete(fail(message.requestId(), Status.DENIED));
                } finally { slots.release(); }
            });
        } catch (RejectedExecutionException rejected) {
            slots.release();
            result.complete(fail(id, closed.get() ? Status.CLOSED : Status.OVERLOADED));
        }
        return result;
    }

    private Reply dispatch(Message m) {
        try {
            return switch (m.action()) {
                case ACTIVATE -> {
                    var r = storage.activate(m.tenant(), m.run(), m.revision(), m.epoch());
                    yield ok(m.requestId(), r.epoch(), r.version(), null);
                }
                case ACCEPT_STEP -> {
                    long v = storage.acceptStep(m.tenant(), m.run(), m.revision(),
                            m.epoch(), m.version(), m.step(), m.messageId(),
                            m.effectKey(), m.digest());
                    yield ok(m.requestId(), m.epoch(), v, null);
                }
                case CLAIM_DISPATCH -> {
                    long v = storage.claimDispatch(m.tenant(), m.run(), m.revision(),
                            m.epoch(), m.version(), m.step(), m.effectKey(), m.digest());
                    yield ok(m.requestId(), m.epoch(), v, null);
                }
                case RECONCILE -> {
                    long v = storage.reconcile(m.tenant(), m.run(), m.revision(),
                            m.epoch(), m.version(), m.step(), m.outcome(), m.receipt());
                    yield ok(m.requestId(), m.epoch(), v, null);
                }
                case FINISH -> {
                    long v = storage.finish(m.tenant(), m.run(), m.revision(),
                            m.epoch(), m.version());
                    yield ok(m.requestId(), m.epoch(), v, null);
                }
                case INSPECT -> {
                    var s = storage.inspect(m.tenant(), m.run(), m.revision());
                    yield ok(m.requestId(), s.epoch(), s.version(), s);
                }
            };
        } catch (NativeWorkflowStore.StorageException failure) {
            return new Reply(m.requestId(), Status.NATIVE_ERROR, failure.status,
                    -1, -1, -1, -1, -1, -1, -1);
        }
    }

    private static Reply ok(String id, long epoch, long version,
            NativeWorkflowStore.Snapshot snapshot) {
        return new Reply(id, Status.OK, NativeWorkflowStore.OK, epoch, version,
                snapshot == null ? -1 : snapshot.prepared(),
                snapshot == null ? -1 : snapshot.inDoubt(),
                snapshot == null ? -1 : snapshot.committed(),
                snapshot == null ? -1 : snapshot.notApplied(),
                snapshot == null ? -1 : snapshot.inboxCount());
    }
    private static Reply fail(String id, Status status) {
        return new Reply(id == null ? "" : id, status, -1, -1, -1,
                -1, -1, -1, -1, -1);
    }
    private static boolean matches(Pattern pattern, String s) {
        return s != null && pattern.matcher(s).matches();
    }
    private static boolean optional(String s) { return s != null && s.length() <= 160; }
    private static boolean valid(Message m) {
        if (m == null || !matches(ID, m.requestId()) || m.action() == null ||
            !matches(ID, m.tenant()) || !matches(ID, m.run()) ||
            !matches(SHA, m.revision()) || m.generation() < 1 ||
            m.epoch() < 0 || m.version() < 0 || m.capability() == null ||
            m.capability().isBlank() || m.capability().length() > 4096 ||
            !optional(m.step()) || !optional(m.messageId()) ||
            !optional(m.effectKey()) || !optional(m.digest()) ||
            !optional(m.outcome()) || !optional(m.receipt())) return false;
        return switch (m.action()) {
            case ACTIVATE, FINISH, INSPECT -> true;
            case ACCEPT_STEP -> matches(ID, m.step()) && matches(ID, m.messageId()) &&
                    matches(ID, m.effectKey()) && matches(DIGEST, m.digest());
            case CLAIM_DISPATCH -> matches(ID, m.step()) &&
                    matches(ID, m.effectKey()) && matches(DIGEST, m.digest());
            case RECONCILE -> matches(ID, m.step()) &&
                    ("committed".equals(m.outcome()) || "not_applied".equals(m.outcome())) &&
                    matches(RECEIPT, m.receipt());
        };
    }

    @Override public synchronized void close() {
        if (closed.compareAndSet(false, true)) worker.shutdown();
        if (handleClosed) return;
        boolean interrupted = false;
        try {
            while (true) {
                try {
                    if (worker.awaitTermination(5, TimeUnit.SECONDS)) break;
                    // Never close JNI handles under an unfinished native call.
                    throw new IllegalStateException("host storage worker is still busy; handle retained");
                } catch (InterruptedException e) { interrupted = true; }
            }
        } finally { if (interrupted) Thread.currentThread().interrupt(); }
        storage.close();
        handleClosed = true;
    }
}
