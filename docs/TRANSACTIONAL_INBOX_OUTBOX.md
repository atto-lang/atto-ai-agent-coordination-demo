# Workflow transactional inbox/outbox: one-shot claim and uncertain-effect recovery

Status: **draft reference + native protocol**, October 29, 2026. Stacked on
[PR #13](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/13).
This is NOT a production distributed workflow engine, native SQLite integration,
cryptographic third-party receipt verifier, or exactly-once delivery guarantee.

## New state machine

Two separate implementations intentionally share state transitions:

1. `src/runtime/workflow_inbox_outbox.ores` is an **in-memory Oreslang actor
   contract** with sealed actor state. It owns one run's bounded logical
   incoming message IDs, step IDs, effect keys/digests, receipts and states.
   Its methods use one exclusive critical loan for each state change.
   It does NOT persist those changes, issue tool commands, authenticate
   callers or serialize/restore state after process death. An authorized
   durable adapter must persist and verify state *before* calling methods.
   This is a **candidate replacement** for overlapping parts of the legacy
   `WorkflowEffectLedgerActor`, not an automatically integrated service.
2. `reference/sqlite-supervisor.mjs` is a separately executed, experimental
   Node 22 SQLite reference with a **transactional inbox/outbox path**:
   `accept_step` first checks the signed tenant/run/revision/epoch/version
   capability, atomically inserts a unique inbox message and a
   `prepared` effect, and increments the CAS version in one SQLite
   `BEGIN IMMEDIATE` transaction. Duplicated message IDs, step IDs or
   effect keys are rejected atomically. `claim_dispatch`, using a distinct
   action-scoped capability, commits the unique `prepared → in_doubt`
   transition **before** any external call. No code in the SQLite model
   actually calls a remote tool.

| State | Meaning | Allowed behavior |
| --- | --- | --- |
| `prepared` / native 0 | Inbox admitted, no dispatch claim | One authenticated/epoch-fenced claim |
| `in_doubt` / native 1 | Claim committed, external result may be unknown | **No retry or second claim**; query authoritative provider |
| `committed` / native 2 | Provider has independently confirmed effect | Record receipt + resolve inbox atomically |
| `not_applied` / native 3 | Provider has proved no external application | Terminal NOT success; explicit higher-level retry policy required |

Legacy `prepare_effect` remains supported for earlier tests and still
records an effect directly as `in_doubt`. Do not interpret its prior
behavior as evidence that nothing was dispatched. The new `accept_step`
and `claim_dispatch` methods are the preferred reference path.

## Failure and concurrency tests actually executed

On local Node **v22.16.0**, using actual SQLite on local disk and OS
subprocesses, `node --test tests/*.test.mjs` passed **17/17 tests**.
The seven new outbox cases test:

- Atomic inbox+prepared-effect admission with duplicate message, step and
  key refusal; failed transactions do not increment workflow version.
- One-time dispatch claim, crash/reopen, new activation epoch and refusal
  of all second claims. No automatic replay of unknown operations.
- Reconciliation binds the exact saved effect key and digest, changes
  effect/inbox status together and rejects unverified receipt claims.
- **Real SIGKILL after the durable claim but before external dispatch**:
  recovery still sees `in_doubt` and refuses to re-dispatch blindly.
- **Real SIGKILL after a simulated external effect commits, before local
  acknowledgement**: recovery uses an authoritative test fixture receipt,
  completes the inbox and workflow, and does not repeat the effect.
- Two separate OS processes simultaneously claiming the same prepared
  effect: exactly one succeeds; the other is fenced, even with the same
  signed capability.
- External receipt verification now occurs **outside SQLite's writer lock**.
  An activation epoch change during verification causes the final commit
  to fail, and inbox/effect state stays unchanged until the new active
  generation reconciles it.

The original ten tests continue to pass, including signed capability
tampering, unauthorized reads, startup WAL race, and cross-process epoch
fencing. The seven-case outbox suite passed **three additional repeated
runs**, and the initial six-case suite passed eight repeats before the
extra verifier/fencing case was added.

Exact Git blob IDs of the executed local source/tests equal the committed
remote files:

- `reference/sqlite-supervisor.mjs`:
  `6fa42c01d700bc3fa783c17551905631b059ded6`
- `reference/workflow-capabilities.mjs`:
  `9c462411e970d7eedf0665c29598d13dd2882865`
- `tests/transactional-outbox.test.mjs`:
  `b980553d5aa6526142375d66790ed0eca9d6fb04`

**These tests are real Node/SQLite tests**, not Java/GraalVM native Oreslang
execution. A simulated remote-effect file is NOT an authenticated
real provider; a test-supplied verifier is NOT secure evidence of the
provider's identity. Neither single-host SQLite nor HMAC test keys provide
distributed consensus, secure tenant isolation against malicious host
code, inter-host fencing or exactly-once external effects.

## Source-only native validation

`WorkflowInboxOutboxActor` structural audit reported 11 fields, six
methods, four write methods and two read methods, with **zero structural
problems**. Five source-only contract assertions passed in V8 against
the exact GitHub blobs. This does NOT prove Oreslang parsing, type checking
or actor runtime behavior.

The full native acceptance manifest has been increased to **at least 23
actor sources** (8 core, 9 memory, 6 runtime), plus three guest source
checks, one ill-typed mailbox negative check and three actual guest
output oracles. The new actor is compile-check-only; a native
end-to-end durable restart fixture is **not yet implemented**.

## Next required real-native integration

1. Implement the `ores.agent.workflow` native storage adapter with
   authenticated capability transport, a storage-enforced epoch CAS,
   transaction-bound inbox/outbox persistence and exact Git/source identity.
   The Node reference cannot substitute for that adapter.
2. Pin and build the exact Java/GraalVM compiler stack including sealed
   actor-state, effects and critical-loan support. Verify all 23 actor
   files with the actual compiler, and run the three existing guest
   programs. Do not report static source checks as native execution.
3. Implement a real native outbox worker that executes a side effect
   **only after** the committed dispatch claim. On restart, reconcile
   in-doubt claims with independently verified external receipts before
   considering any retry or compensation.
4. Inject native worker SIGKILL before/after remote commit, stale epoch,
   duplicate inbox, crash during SQLite transaction, cross-tenant
   spoofing, and cancellation/compensation with authenticated policy.
5. Verify the same behavior across Java, LLVM, .NET, WASM and Forge.
   Keep all stacked PRs **draft** pending real CI with executed steps
   and independent review; do not transfer private source to another org
   without separate authorization.
