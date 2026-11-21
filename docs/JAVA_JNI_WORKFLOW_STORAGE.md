# Java/JNI → C++/SQLite workflow binding: executable host integration

Status: **draft host-native integration**, October 29, 2026. Stacks on
[Native Workflow Storage PR #19](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/19).
It establishes a **real JDK-to-JNI-to-native C++/SQLite execution path**, but
does not establish an Oreslang guest-language call or GraalVM Native Image AOT.

## Delivered

- `bridge/java/dev/oreslang/workflow/NativeWorkflowStore.java`: typed host
  Java API, explicit `Lease(epoch, version)` and
  `Snapshot(epoch,version,prepared,inDoubt,committed,notApplied,inboxCount)`,
  `AutoCloseable` handle lifecycle, synchronized methods, explicit native
  result-code exceptions, and non-exported raw JNI pointers.
- `bridge/jni/workflow_jni.cpp`: JNI marshaling to PR #19's *unchanged*
  `native/workflow_sqlite.cpp` and `workflow_sqlite.h`. It keeps a Java
  `Policy` global reference valid until `wf_close`, exposes no raw JNI
  pointer to the Java public API, attaches native callback threads to the
  JVM when needed, deletes JNI local references, converts C ABI callback
  arguments into typed `Call`/`Receipt` objects, and fails closed when
  Java authorization or receipt-verification callbacks throw.
- `scripts/check-jni-workflow.sh`: locally compiles Java classes and a
  `libores_workflow_jni.so` from the preexisting C++/SQLite source and the
  new JNI shim, using a discovered JDK installation, C++17 warnings as errors,
  system SQLite, a 35-second total execution timeout and a subprocess
  kill-after grace.
- `tests/java/dev/oreslang/workflow/NativeWorkflowBridgeTest.java`:
  live Java-host/JNI/SQLite protocol, denial/replay/handle-lifetime tests,
  and real Java process termination in two phases: after a durable claim
  but before any simulated remote effect; and after a simulated remote
  effect was written but before the local acknowledgment.
- `.github/workflows/java-jni-workflow.yml`: intentionally separate
  GitHub-hosted JNI proof, with read-only permissions and no tokens or
  cross-organization private-source mirroring.

## Actually executed evidence

On local OpenJDK **21.0.12.1**, SQLite **3.46.1**, Linux, the command

```sh
bash scripts/check-jni-workflow.sh
```

compiled the actual Java/JNI/C++ shared library and ran
`JNI_WORKFLOW_BRIDGE_RESULT passed=4 native_library=ores_workflow_jni`.
It passed **four consecutive GCC builds/test executions** and a separate
Clang++ build/test execution. The four high-level test groups cover:

1. Storage admission, stale epoch, duplicate effect/inbox, inspected states,
   forged/missing receipt, wrong message ID, disabled authorization and
   Java callback exceptions failing closed.
2. Closed JNI handle rejection and repeated close safety.
3. Real child-process forceful termination after `claim_dispatch`, before
   external effect; restart and activation preserve in-doubt state and refuse
   redispatch or a missing provider receipt.
4. Real child-process forceful termination after simulated remote effect
   commit, before local receipt acknowledgment; restart with higher epoch,
   authoritative fixture lookup, verified settlement, and finished workflow
   without executing the effect again.

The external provider is an **ordinary test file**, not a signed commercial
service. The test `HostPolicy` is a deliberately simplified allowlist
and never represents a production capability issuer.

Exact local Git blob SHA of each source matched the corresponding GitHub
file on the feature branch:

- Java host API:
  `a8e864b4330ce2600694c02ee643b61abd562efa`
- JNI C++ shim:
  `1a98185873ac4f88bfd8b61f1c3cae91eb1af3d9`
- Java process-kill test:
  `120fd8ba812ed2770a2d1425ac2514b602d5637d`
- Bounded build script:
  `08394c4d6255f2a08784578d3d649e17cc499471`

The underlying native C ABI and SQLite implementation were **not
modified** by this PR. The same source blob hashes are inherited from
PR #19 (`native/workflow_sqlite.cpp`:
`6e1373312df2d90269b352a223fcdcb074a94e0c`).

## Boundaries not yet implemented

1. **Oreslang guest-to-host invocation:** The existing
   `contracts/native/workflow_storage.ores` remains only a typed
   declaration. There is no Java compiler lowering, guest-native
   `WorkflowDurableStorage` instance, actor-message adapter, or
   injected capability-backed host service. Java tests bypass the Oreslang
   parser/runtime entirely. Do not claim a native `.ores` guest ran.
2. **GraalVM Native Image:** This evidence is on an ordinary JVM (JDK21).
   `System.loadLibrary`, JNI registration and native callbacks require
   separate GraalVM JDK25 Native Image configuration, actual AOT build,
   and runtime tests. Not proved.
3. **Authorization:** The trusted Java `Policy` is supplied by the
   embedding host. An untrusted actor must not choose this policy, invoke
   `open`, or mint capabilities. Production needs a genuine signed
   capability issuer with revocation, KMS and audited policy checks.
4. **Crash proof:** Two actual child Java processes are forcefully
   terminated. SQLite retains durable state, but these children are not
   Oreslang actors, and simulated provider receipt lookup is not
   independent remote authentication.
5. **Native concurrency/memory safety:** JNI handles are serialized at
   the Java instance boundary, and native SQLite uses per-store mutexes.
   This is not a hardened host process or a fully adversarial JNI
   sandbox; callbacks that block, reenter foreign code or hold invalid
   external references require further audit and stress testing.
6. **Platform scope:** Current Linux/JDK build harness assumes JNI
   `linux/jni_md.h`, GNU `timeout`, g++/clang++, and `libsqlite3`.
   Windows/macOS, LLVM-native embedding and WASM/.NET/Forge require
   separate adapter implementations.

## Next acceptance gates

1. Implement a **trusted Java runtime host service** that exposes the
   typed storage port to an Oreslang actor without granting the actor
   Java FFI, JNI pointer access, file-system authority or policy
   construction. Use actor-message/channels and immutable owned payloads.
2. Compile an actual `.ores` fixture using an exact pinned Java compiler
   with sealed state, `critical` loans and effect-aware suspension.
3. Execute that fixture through Java and the JNI library, then kill the
   **actual Oreslang runtime process**, restore actor generation and
   fencing epoch, and reconcile an in-doubt external effect once.
4. Build with GraalVM 25/JDK25 Native Image and prove the same guest
   behavior; then port the C ABI binding to LLVM, .NET, WASM and Forge.
5. Use only **nonzero-step executed** CI evidence. Prior source-organization
   GitHub Actions runs failed before test steps; runner admission needs
   investigation. Keep the PR and all parent PRs **draft** pending review.

No private source copied to another organization and no merge attempted.
