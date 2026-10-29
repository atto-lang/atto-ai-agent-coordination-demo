# Oreslang AI agent coordination via actors

A **userland, native Oreslang** experiment in long-lived isolated actors for AI agent coordination, graph state, cache reuse, decision branching, and fail-closed workflow admission.

**Status:** initial implementation/prototype. The source is intended to track the Oreslang Java reference compiler and later LLVM/.NET/Wasm parity. This project does **not yet claim native compilation, durable recovery, distributed routing, authentication, hard real-time guarantees, or production readiness**.

## Actor flavors

| Actor | Source | Responsibility |
| --- | --- | --- |
| `KnowledgeGraphActor` | `src/knowledge_graph.ores` | Bounded directed entity/relationship partition, revisioned lookup and traversal |
| `KnowledgeCacheActor` | `src/knowledge_cache.ores` | Version-pinned cache, caller-provided logical expiry, explicit invalidation |
| `DecisionTreeActor` | `src/decision_tree.ores` | Deterministic branch routing using caller-evaluated predicates |
| `DecisionGateActor` | `src/decision_gate.ores` | Exact-revision evidence + independent approval, deny-by-default |
| `EvidenceLedgerActor` | `src/evidence_ledger.ores` | Append-only bounded evidence receipts with subject/revision digest |
| `AgentCoordinatorActor` | `src/agent_coordinator.ores` | Bounded in-flight work tickets, idempotent rejection, settlement |
| `AgentWorkflowActor` | `src/workflow.ores` | Version-checked workflow transitions and cancellation |
| `AgentRegistryActor` | `src/agent_registry.ores` | Agent capability/incarnation registry (logical metadata only) |

All actor state is owned by an `isoactor`. No new compiler keyword or special actor flavor is assumed. Graph nodes are compact records, *not* individually scheduled actors.

## Example: repository intelligence graph

A code-indexer ingests symbols, files and dependency edges into a `KnowledgeGraphActor` shard, then caches revision-keyed query results in a `KnowledgeCacheActor`. A code-review agent requests neighbors, asks `DecisionTreeActor` which checks to run, and opens a `DecisionGateActor` on the exact commit SHA. An authorized control-plane caller supplies actual executed CI evidence and independently authenticated approval; the actor must reject zero-step checks, stale commits or stale epochs. `AgentCoordinatorActor` limits concurrent tasks, while `AgentWorkflowActor` tracks the state of one action.

See [architecture](docs/ARCHITECTURE.md), [invariants and trust boundaries](docs/INVARIANTS.md), and [example scenario](examples/repository-agent-flow.md).

## Validation

```sh
node --test tests/actor-source-contracts.test.mjs
```

These are **source/structure checks only**, *not* proof of Oreslang compilation or runtime semantics. The workflow runs in this repository without external source mirroring. Native compiler execution must use authorized environments and be reported separately, including actual job-step evidence.

## Userland constraints

- Native Oreslang modules/actors first; no Java-interop dependency for language semantics.
- Avoid Python tooling. `node` is used only for a dependency-free static test harness in the prototype; long-term tooling can be ported to Rust.
- No implicit `Future`/`Option` flattening or operator overloading.
- Non-reentrant actor state access; no blocking calls in handlers.
- Do not conflate logical `isoactor` confinement with proven dedicated physical heaps or OS isolation.
- No private-source transfer to an alternate GitHub organization without independent authorization.
