# Native workflow SQLite adapter — host implementation, Oreslang contract and gates

Status: **draft experimental integration**, 2026-10-29. Stacked on the
[transactional inbox/outbox PR #16](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/16).

## Scope

This changes the storage reference boundary in an important way:

- `native/workflow_sqlite.cpp` and `native/workflow_sqlite.h` form a real
  **C++17 C-ABI host library** backed by native `sqlite3`. There is NO
  Node.js engine, subprocess shell or JavaScript implementation of the
  transaction path.
- `contracts/native/workflow_storage.ores` is an **Oreslang-facing typed
  storage contract only**. It is NOT implemented, linked, or invoked by the
  current Java/LLVM/Forge/.NET/WASM Oreslang runtimes. Its method signatures
  are compiler check targets; the expected Java compiler may reject them
  until language integration catches up.
- `WorkflowSupervisorActor` and `WorkflowInboxOutboxActor` remain
  separate in-memory native Oreslang actors. They do **not** silently persist
  or restore themselves through this driver yet.

## Implemented native persistence

The adapter uses an owner-private local directory, rejects unsafe
database symlink/hardlink paths, configures WAL and FULL synchronous mode,
and uses SQLite `BEGIN IMMEDIATE` transactions for writes.

The native C ABI includes:
- `wf_create_run` and `wf_activate`: exact tenant/run/Git-revision
  identity, monotonically advancing epoch and CAS version
- `wf_accept_step`: atomically commit unique inbox message, step and
  prepared outbox effect, or roll all changes back
- `wf_claim_dispatch`: atomically claim `prepared -> in_doubt` once;
  **a timeout or restart never reclaims that dispatch automatically**
- `wf_reconcile`: call trusted remote receipt verification **outside**
  SQLite's write transaction, then atomically recheck epoch/version,
  step/key/digest before updating effect and inbox
- `wf_finish`: refuse finishing while there are no effects, or if any
  effect remains prepared, in doubt, or proved not applied
- `wf_inspect`: authenticated host snapshot read using one database
  read transaction, not a worker-dispatch permission

The driver holds a mutex around a shared SQLite connection's individual
operations, but deliberately releases it before potentially slow receipt
verification. Errors are returned as explicit `WF_*` results.

## Authorization limitation — important

All C ABI writes and reads require a **host-supplied authorization callback**,
which receives action, tenant, run, revision, epoch, version, step, effect key,
digest, incoming message ID and relevant receipt/outcome fields.
Receipt verification is a **second independently supplied callback**.

This does NOT itself implement HMAC validation or KMS: the callback owner is a
trusted host process. The C++ test callback is deliberately permissive for
the authorized paths and must never be used in production. A malicious
caller who can supply arbitrary callbacks must not be allowed to open the
store. The signer, capability verification, external tool identity,
revocation and dispatch authorization belong in the independent trusted
control plane and real Oreslang bridge.

The C++ API remains a local host adapter, **not** a distributed lease and not
a guarantee of exactly-once remote side effects. The receipt provider is
simulated in tests using a local fsynced file.

## Actually executed C++ evidence

On the working host with `g++`, `pkg-config` and SQLite 3.46.1:
`bash scripts/check-native-sqlite.sh` compiled the native test binary with
`-std=c++17 -Wall -Wextra -Werror -O2` and executed **7/7 cases**:
1. Atomic inbox/outbox admission and duplicate/replay refusal.
2. A competing activation epoch during external receipt verification,
   with post-verification CAS rejection.
3. Real `SIGKILL` after a simulated external effect was committed before
   local acknowledgment; restart reconciles once without resending.
4. Two independent processes competing to claim one prepared effect;
   exactly one wins.
5. SQLite DB symlink refusal.
6. Real `SIGKILL` after the dispatch claim but **before** a remote effect;
   the in-doubt claim is never blindly resent.
7. Two local threads sharing the same native store connection race for one
   dispatch claim; one wins and one is fenced.

The test binary passed three additional complete repeated runs, and a
separate `-fsanitize=address,undefined` build passed all seven cases.
`timeout --kill-after=5s 30s` now bounds the normal test execution.

Exact remote Git blob SHA = locally compiled/tested file SHA:
- `native/workflow_sqlite.h`: `1988922c0dd789e0a0dd271e560d59daf002f7bb`
- `native/workflow_sqlite.cpp`: `6e1373312df2d90269b352a223fcdcb074a94e0c`
- `tests/native_sqlite_test.cpp`: `0f3175aca99c372646e00056655104475c650363`
- `scripts/check-native-sqlite.sh`: `945879aa6da549240d81f2bccee08e361fb20e86`

These tests execute **native C++/SQLite**, but do not execute an Oreslang
guest. Their simulated external receipt and permissive test callbacks do
not prove real provider authorization or native actor recovery.

## Execution and acceptance gates

```bash
# Linux build with g++, pkg-config, sqlite3 headers/libs and GNU timeout
bash scripts/check-native-sqlite.sh

# A separate, owner-authorized host with GraalVM/JDK25, Maven and exact
# Oreslang Java compiler checkout can additionally attempt the full gate:
export ORESLANG_COMPILER_ROOT=/absolute/path/to/oreslang-source.java
export ORESLANG_COMPILER_SHA="$(git -C "$ORESLANG_COMPILER_ROOT" rev-parse HEAD)"
export ORESLANG_DEMO_SHA="$(git rev-parse HEAD)"
node scripts/run-native-acceptance.mjs
```

The full compiler source manifest now requires **23 actor sources,
three executable guest sources, one Oreslang storage contract**
(27 positive compile inputs) and the one targeted negative mailbox fixture.
The host C++ tests are separately required by the owner-local full gate.
`guest-only` remains intentionally separate from native storage proof.

Critical next work, **not yet implemented**: trusted compiler-supported
Oreslang FFI/foreign-call integration for this ABI; runtime ownership of a
storage connection independent from actor-critical state loans; native actor
checkpoint serialization, restored generation and durable mailbox admission;
real native actor restart; and actual third-party tool receipt validation.
Then prove Java guest execution and backend conformance on LLVM, .NET, WASM
and Forge. Keep this PR and its parents draft. Do not mirror private source
to another organization without explicit authorization.
