# Trusted workflow storage mailbox — host boundary and execution evidence

**Status:** draft host-runtime integration, October 29, 2026; stacked on
[PR #21](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/21).
This change is **not** an implemented Oreslang guest-language storage binding.

## New host execution boundary

- `bridge/java/dev/oreslang/workflow/WorkflowStorageMailbox.java` accepts only immutable, scalar `Message` records, not Java/JNI pointers or filesystem paths. Requests contain a distinct request ID; tenant, run and exact revision; actor generation; durable activation epoch and CAS version; optional bounded step/message/effect/receipt fields; and a capability **string**.
- A **host-owned** `Admission` callback checks the full request, issuer signature, expiry, generation, revocation, and policy **on the dedicated storage worker**, immediately before any JNI call. **The service does not issue tokens, verify signatures, or establish who may construct its host dependencies.** Only the embedding host may supply `NativeWorkflowStore`, the callback and its trusted keys.
- The service holds at most a configured 1–1,024 outstanding messages via a semaphore and single worker; full admission returns `OVERLOADED`, invalid data returns `BAD_MESSAGE`, policy failure returns `DENIED`. I/O runs asynchronously on a host thread rather than inline on the calling actor carrier.
- The service exposes only detached `Reply` scalars: native result code, persisted epoch/version and aggregate snapshot counters. It does **not** expose `NativeWorkflowStore`, `Policy`, JNI pointer, connection handle, SQLite path or callback references in a reply.
- `ACTIVATE`, `ACCEPT_STEP`, `CLAIM_DISPATCH`, `RECONCILE`, `FINISH` and `INSPECT` map to the previously verified native C ABI through `NativeWorkflowStore`. The existing SQLite driver supplies actual transactional storage. `CREATE_RUN` intentionally remains a trusted host bootstrap action and is **not** exposed to the actor mailbox.
- An in-doubt effect remains in doubt after a process crash. It is not automatically reclaimed or repeated; recovery must use the signed host policy and independently verified receipt provider.
- No storage call is performed by this mailbox inside an Oreslang `handle_state(critical ...)` loan. **The Oreslang compiler still needs to enforce that callers release all loans before submitting/awaiting storage requests.** A host thread alone is not a language-level borrow-checking proof.

## Actual local test evidence

Command: `bash scripts/check-workflow-mailbox.sh` on OpenJDK **21.0.12.1** with C++17, JNI and native SQLite.

- Existing `JNI_WORKFLOW_BRIDGE_RESULT passed=4`, rebuilt from `native/workflow_sqlite.cpp` and `bridge/jni/workflow_jni.cpp`.
- New `WORKFLOW_MAILBOX_RESULT passed=4 host_only=true`; **three additional complete repeated executions** also passed.
- Four mailbox groups: admitted durable workflow/receipt lifecycle and tenant spoofing refusal; revoked/stale-generation denial; bounded backpressure with worker-only policy evaluation; actual Java child-process termination after a *simulated* remote effect and restoration at a higher epoch, without a second claim.
- A controlled local receipt file represents an external provider; a test-only hardcoded HMAC key is used by the test's issuer. This is **not** cryptographic remote-provider evidence and is not a deployment issuer.

Exactly compiled local Git blobs equal branch Git blobs:
- `WorkflowStorageMailbox.java`: `b2351ea8daced31625a3c976fa442d3f880dd527`
- `WorkflowStorageMailboxTest.java`: `1c7968c772ff1d2576d05b7d927c7c64b1ec8785`
- `check-workflow-mailbox.sh`: `917ffc7299735f8d71570fe433d82b0740422fc3`

The host-native test does **not** compile or execute `.ores` programs, test an
actor-internal lifecycle, prove GraalVM Native Image AOT, or establish five-backend parity.
No real third-party provider, distributed lease, or production issuer was exercised.

## Next integration work that still must happen

1. **Java compiler/runtime:** in `oreslang-source.java`, implement a default-deny host service registry owned by `OresContext` or the VM; expose an actor-message port, **not** unrestricted `java:` host-object lookup. Prevent untrusted actors from constructing policy callbacks, opening a DB, or receiving native handles. Compiler must type-check the message contract, serialize owned message values, enforce `Sendable`, and reject borrow/critical-loan escape across submission and suspension.
2. **Actual Oreslang guest:** compile a `.ores` supervisor/step guest with the integrated compiler, feed its messages through the injected service, **terminate its real process**, restart with an authenticated newer epoch, load durable inbox/outbox checkpoint, and reconcile a remote receipt exactly once.
3. **Trusted issuer:** replace the test-only key and test callback with authenticated, revocable, short-lived capabilities bound to tenant, actor generation, revision, action, step, digest, expiry, and receipt. KMS/issuer management belongs to the control plane, not the actor.
4. **Failure handling:** harden worker shutdown and stuck/slow policy callbacks without closing JNI while active; enforce cancellation semantics and quotas. Test concurrent actor mailboxes, close races, actor-generation restarts and denial/timeout cases.
5. **Execution gates:** use a pinned clean compiler tree with GraalVM JDK25, run all existing `--check` inputs and real `.ores` guest stdout oracles; then AOT, LLVM, .NET, WASM and Forge. The source organization has repeatedly failed job admission before executing any steps. Never conflate source contracts or host-only tests with this guest-runtime proof.

Keep PRs #19, #21 and this stacked PR draft. Do not transfer private source across organizations without independent approval.
