# AI agent operating runtime: actor, knowledge, decision, execution graphs

**Status:** architecture plus three in-memory userland actors; not durable or distributed. The syntax in `src/runtime/` follows existing `isoactor` prototypes and still needs a pinned Oreslang compiler/guest execution verdict. No new language keyword is proposed.

## Four cooperating graphs

| Graph | Logical nodes | Edges | Authority |
| --- | --- | --- | --- |
| Actor graph | Long-lived actors and transient agents | Typed messages, delegation, subscriptions | Supervisor / capability registry |
| Knowledge graph | Entities, symbols, documents, evidence | Typed relationships and provenance | Authoritative source + verified ingest |
| Decision graph | Predicates, branches, terminal outcomes | Guarded control-flow routes | Deterministic policy gate |
| Execution graph | Tasks and workflow steps | Dependencies / fan-out / fan-in | Authorized dispatcher + effect ledger |

A *GraphShardActor* is currently a **deployment role** played by `KnowledgeGraphActor` (one partition). Creating an additional near-identical class would duplicate its source of truth. A partition directory, stable hash routing, snapshot coordinator and actor-to-actor typed transport are future work.

Graph topology does not dictate physical placement. `ActorRouteDirectoryActor` stores a stable logical actor ID and rejects stale (incarnation, generation, route epoch) pairs after relocation. Its placement is just metadata: it does not move actors, deliver messages, authenticate callers or persist registration.

`ExecutionGraphActor` models task dependencies without invoking LLMs or tools. It allows parallel ready nodes and a fan-in that becomes ready only after **every** prerequisite succeeds. It requires backward-only dependencies to enforce a DAG by construction, a sealed topology before execution, and compare-and-set revision checks for all transitions. Failures remain visible; they are not silently retried.

`WorkflowEffectLedgerActor` models a unique external idempotency key across prepare, dispatch, reconcile and safe pre-dispatch cancellation. A dispatched effect has **unknown** status until an independently authenticated external receipt says whether it was applied. Duplicate prepare, dispatch replay, and cancellation-after-dispatch are rejected. This is not an outbox or WAL: actor restart currently loses the ledger and no remote tool is called.

## Separation of authority

1. A model/agent may **propose** a task, candidate fact or branch; it never grants itself a capability.
2. The graph scheduler consults typed prerequisites and bounded admission limits.
3. A policy actor checks exact revision, non-zero executed CI steps and independent approval before authorizing dangerous work.
4. Before an externally visible effect, an authenticated adapter stores the command/idempotency key durably, obtains a valid lease, and initiates the effect. No such adapter is implemented in this prototype.
5. After a timeout or crash, the coordinator checks the remote idempotency key and reconciles unknown outcomes. It may not infer success from a model statement, replay automatically, or erase a dispatched command.
6. Memory retrieval must pin the repository, branch, revision, current head generation, and source evidence before use.

Do not hold actor state locks across network requests or model inference. Actor state is owned by a non-reentrant handler; concurrency between readers is a **design target** requiring separately verified immutable snapshots/critical-read semantics, not a claim for the current code.

## Three-worker experiment

[PR #1's guest fixture](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/blob/3227eb051f68fa94004298ce719f31741164e45f/tests/guest/agent_pipeline.ores) describes Research, Analysis and Execution agents sharing a long-lived cache via main-mediated routing. It demonstrates the intended workload, **not** direct actor-to-actor messages, LLM execution, tool side effects or durability. A useful next phase is to bind these workers to an `ExecutionGraphActor`, create one revision-pinned task record per step, and use `WorkflowEffectLedgerActor` for execution authorization only after a real journal and policy adapter exist.

### Required crash/restart proof, not yet implemented

1. Start three workers and one graph cache. Use a **durable** event log and a **durable** outbox with an idempotency key for each external effect.
2. Execute research and analysis; persist their committed results, exact source revision and evidence receipts.
3. Intentionally terminate the coordinator **after dispatch but before acknowledgement** of one external effect (e.g. SIGKILL).
4. Reactivate the workflow from committed snapshot + WAL, reconstruct actor identity, graph state and queued tasks.
5. Reconcile the in-doubt effect by its idempotency key. Never count a duplicate external effect as success.
6. Verify with an external durable counter and exact execution logs: completed steps are preserved; no successful step is repeated; unknown outcomes are not assumed successful; unfinished work resumes.
7. Repeat crashes before prepare, after prepare, during dispatch, after effect but before receipt, after receipt, and during checkpoint. Verify recovery and no cross-generation stale-message authority.

A successful unit test of in-memory actors is **not** this proof. A checkpoint manifest containing only a storage pointer cannot recover actor state.

## Cross-backend delivery order

| Milestone | Components | Exit criterion |
| --- | --- | --- |
| P0 | `oreslang-agent-runtime`, `oreslang-agent-graph`, `oreslang-agent-memory` | Compile and execute Java/Graal guest tests for typed worker messages, graph state, routing generations and memory retrieval |
| P1 | `oreslang-agent-workflow`, `oreslang-agent-tools` | Persisted WAL/outbox, authenticated effects, supervised restart, crash injection and no duplicate side effects |
| P2 | `oreslang-agent-cluster` | Multi-host placement/migration, capacity quotas, partition recovery, verified failure isolation |

Once P0 semantics are guest-tested, run the **same** language-level fixtures on LLVM, .NET, Wasm and Forge where supported. No claims of parity from source files or reference models alone.

See [memory pipeline](MEMORY_PIPELINE.md), [invariants](INVARIANTS.md), [PR #1's native acceptance gate](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/blob/3227eb051f68fa94004298ce719f31741164e45f/docs/P0_NATIVE_ACCEPTANCE.md) and [additional runtime acceptance scenarios](../tests/actor-runtime-acceptance.md).
