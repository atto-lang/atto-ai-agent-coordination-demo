# Step Functions ↔ AI Agent Coordination — hardening and acceptance contract

Date: 2026-10-29. This design was checked against the separate private
[Oreslang Step Function Demo](https://github.com/ores-truffle-oreslang/oreslang-step-function-demo)
and the existing actor-step-function discussion. No source was mirrored into
another organization. Keep this feature branch stacked on the agent runtime
PR #3 until independently reviewed.

## Source-grounded behavior, without overstating it

The step-function demo's `main` declares nine **native Oreslang source**
fixtures for order fan-out/join, rejection, agent memory capture and quarantine,
preview-only review, a bounded two-attempt retry, cancellation before spawn and
a phase-guarded coordinator. Its
[`ci/native-cases.txt`](https://github.com/ores-truffle-oreslang/oreslang-step-function-demo/blob/main/ci/native-cases.txt)
pins nine expected stdout values. Its
[`ci/verify-native.sh`](https://github.com/ores-truffle-oreslang/oreslang-step-function-demo/blob/main/ci/verify-native.sh)
requires a pinned real compiler binary and rejects missing compiler,
unbounded execution and stdout drift.

**Neither the step-function repo nor this agent demo has established a native
guest pass for those new programs.** The JSON graphs are *design diagrams*,
not executable workflow interpreters. The old step-demo Node.js test results
concern a removed historical engine, not the native examples.

The step demo's draft coordinator-state migration uses sealed state and a
critical-write callback, publishing output **after** releasing the loan.
The combined native compiler still has to prove that syntax and borrow
behavior. We reuse the intended discipline, **not** its runtime claims.

## Implementation in this branch (userland Oreslang, no graph keyword)

- `src/runtime/step_run.ores` adds a single logical step's isolated,
  sealed state: `tenant_id`, `run_id`, `step_id`, exact source revision,
  activation epoch, CAS version, phase, bounded attempts (1–8),
  per-attempt unique idempotency keys and receipt metadata.
- Only `ready` and explicitly safe `retry-allowed` can begin an
  attempt. An in-flight timeout transitions to `in-doubt` and **cannot**
  retry or cancel. A trusted externally reconciled receipt must explicitly
  report `committed` or `not applied`. Unknown stays frozen.
- All state transitions occur inside a single exclusive `handle_state`
  loan. No `await`, I/O, actor send, tool call or LLM inference is performed
  inside that loan. Read-only projections are scalar values, not owned arrays.
- `ExecutionGraphActor.cancel_blocked` now cancels a pending DAG node only
  when a prerequisite is already failed or cancelled. It rejects pending roots,
  healthy dependencies, stale graph revisions and already-dispatched nodes.
  It does **not** interrupt or compensate running tasks.
- `tests/guest/step_agent_flow.ores` is a new **compiler-targeted native**
  four-actor scenario: coordinator rejects early complete, foreign run and
  duplicate start; research → review → preview is fixture-only, then the
  guard completes. Exact stdout:
  `agent-step:preview-complete`.
- The independent `run-step-native-guest.mjs` checks exact demo/compiler Git
  SHA and tracked clean checkouts, executes the **real Java OresMain guest**
  with timeout and byte-exact oracle. The full
  `run-native-acceptance.mjs` now requires it as the **third** guest after
  compiling every actor/guest source plus the targeted negative typed mailbox
  fixture. It checks returned source SHA-256 hashes and each result's exit
  status, and refuses missing/forged-complete evidence markers.

This adds **step-run state tracking**, not a complete Step Functions runtime.
Graph topology remains in `ExecutionGraphActor` (bounded DAG, fan-out/fan-in);
the step actor is deliberately one *logical step*, not one actor per graph
edge or knowledge entity. General scheduling, durable logical IDs, retries
with timers/backoff, supervisor lifecycle and compensating sagas remain
separate general-purpose libraries.

## Critical trust and durability boundaries

1. **No native credential checking:** actor methods currently accept tenant,
   source revision, evidence strings and receipt IDs as arguments. An
   authenticated policy/capability adapter must verify all of them and
   authorize actor calls before they can influence a real tool dispatcher.
   No model string or fixture review result is an approval capability.
2. **No durable execution:** `StepRunActor`, `ExecutionGraphActor`,
   `WorkflowEffectLedgerActor` and the routing directory are in-memory.
   Their compare-and-set counters do not constitute database/cluster fencing.
   Persist inbox claim, step state and outbox intents transactionally under
   a storage-enforced epoch before **any** external dispatch.
3. **No exactly-once tool effect:** the workflow ledger's dispatched state
   means **outcome unknown** until authenticated query-by-idempotency-key
   reconciliation. Retrying unknown outcomes is forbidden. Duplicate receipt
   rejection alone is insufficient to prove that a receipt is authentic.
4. **No generic timers/retry engine:** a maximum of eight declared attempts
   limits *count*; it does not implement scheduled backoff, deadlines or
   preemptive cancellation. Running work must be reconciled, not erased.
5. **No full saga:** the step-function demo has separate checkout saga draft
   work, including LIFO compensation. This branch does not import unfinished
   saga code or assert that a successful preview performed compensation.
6. **No native actor-state proof:** Java `main` still requires integrated
   sealed actor state, borrow/effect checking and callback result semantics
   before all 21 isolated actors can compile. The guest fixture intentionally
   uses the older supported `define actor` syntax as an independent smoke;
   it does not prove sealed-state isolation.
7. **No cross-org source transfer:** private Git trees stay inside their
   approved organization until separate source/destination authorization.

## Exact release acceptance — currently not executed

On an owner-authorized host containing a freshly built, pinned Java/GraalVM
compiler and an exact clean demo checkout:

```sh
export ORESLANG_COMPILER_ROOT=/absolute/path/to/oreslang-source.java
export ORESLANG_COMPILER_SHA="$(git -C "$ORESLANG_COMPILER_ROOT" rev-parse HEAD)"
export ORESLANG_DEMO_SHA="$(git rev-parse HEAD)"
node --test tests/*.test.mjs
node scripts/run-step-native-guest.mjs   # independent step smoke
node scripts/run-native-acceptance.mjs   # all actors + 3 guest executions
```

The full gate expects **at least 21** native actor sources across the three
known directories, **3** positive guest sources, **1** ill-typed mailbox
negative, and **3** executed exact-stdout guests. It dynamically validates
the actual actor manifest rather than reporting an obsolete count. A GitHub
Actions failure with zero steps is an admission failure, not compiler proof.

The new static test `tests/step-function-integration.test.mjs` runs source
invariant assertions and a fail-closed runner admission test. Its passing
checks are **not** execution of `.ores`. The native compiler and full
crash/restart tests remain the release gates.

## Future parity and failure cases

Required executed cases: real concurrent child fan-out/fan-in; duplicate
child completion; foreign tenant/run messages; stale epoch and source revision;
timeout-after-remote-commit; idempotency-key replay; exhausted retry budget;
cancellation before dispatch vs in-flight; failed prerequisite; LIFO
compensation after partial commit; SIGKILL after tool dispatch/before receipt;
restart with storage fencing; authentic human approval and zero-step CI
rejection. Run the *same semantic fixtures* on Java, LLVM, .NET, WASM and
Forge only when each backend implements the needed features.
