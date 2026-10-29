# Oreslang AI agent coordination via actors

A **userland, native Oreslang** experiment in long-lived isolated actors for AI agent coordination, graph state, cache reuse, decision branching, and fail-closed workflow admission.

**Status:** initial implementation/prototype. The source is intended to track the Oreslang Java reference compiler and later LLVM/.NET/Wasm parity. This project does **not yet claim native compilation, durable recovery, distributed routing, authentication, hard real-time guarantees, or production readiness**.

## Actor flavors

| Actor | Source | Responsibility |
| --- | --- | --- |
| `KnowledgeGraphActor` | `src/knowledge_graph.ores` | Bounded directed entity/relationship partition, revisioned lookup and traversal |
| `KnowledgeCacheActor` | `src/knowledge_cache.ores` | Single-graph cache, increasing revisions, caller-provided logical expiry, expired-slot reuse |
| `DecisionTreeActor` | `src/decision_tree.ores` | Closed acyclic decision DAG with explicit terminals and caller-evaluated predicates |
| `DecisionGateActor` | `src/decision_gate.ores` | Exact-revision evidence + independent approval, deny-by-default |
| `EvidenceLedgerActor` | `src/evidence_ledger.ores` | Append-only bounded evidence receipts with subject/revision digest |
| `AgentCoordinatorActor` | `src/agent_coordinator.ores` | Bounded in-flight work tickets, idempotent rejection, settlement |
| `AgentWorkflowActor` | `src/workflow.ores` | Version-checked workflow transitions and cancellation |
| `AgentRegistryActor` | `src/agent_registry.ores` | Agent capability/incarnation registry (logical metadata only) |

All eight source actors are declared with `define isolated actor Name as ... end`, and their methods omit `fnc`. This is an isolation declaration, not proof of physical arena/heap separation or process sandboxing. Graph nodes are compact records, *not* individually scheduled actors.

## Coding-agent memory pipeline

Nine additional native userland actors live under `src/memory/`: ingestion, extraction, verification, consolidation, indexing, retrieval, branch-head invalidation, context assembly, and an external-checkpoint manifest.

This subsystem tracks **untrusted observations separately from verified facts**, supports exact Git-revision-scoped reads and bounded context packages, and records externally persisted checkpoint references. **It does not yet implement persistent storage, authenticated network routing, actual tokenization, LLM extraction, atomic cross-actor updates, or runtime recovery.**

Read [the memory-pipeline architecture](docs/MEMORY_PIPELINE.md) and the [native guest acceptance matrix](tests/memory-guest-acceptance.md). The source-only checks live in `tests/memory-source-contracts.test.mjs` and run alongside the existing graph contracts and JS reference models.

## Agent operating-runtime graph contracts

Four isolated-actor prototypes under `src/runtime/` extend the **actor graph** and **execution graph** while reusing `KnowledgeGraphActor` as a knowledge-graph shard and `DecisionTreeActor` / `DecisionGateActor` for deterministic decisions:

| Actor | Purpose |
| --- | --- |
| `ActorRouteDirectoryActor` | Stable logical names, incarnation/generation/route-epoch-pinned placement hints |
| `ExecutionGraphActor` | Bounded dependency DAG, parallel ready nodes, fan-in, revision-checked transitions |
| `WorkflowEffectLedgerActor` | One-time effect preparation, dispatched/unknown status, explicit external reconciliation |
| `StepRunActor` | Single-run step phases, CAS fencing, 1–8 attempts, unique keys, in-doubt freeze |

The graph/placement model is **not** a distributed actor transport; workflow effect bookkeeping is **not** durable storage, exactly-once delivery or tool execution. See [the actor/runtime architecture](docs/AGENT_RUNTIME_ARCHITECTURE.md) and [native runtime acceptance matrix](tests/actor-runtime-acceptance.md).

## Example: repository intelligence graph

A code-indexer ingests symbols, files and dependency edges into a `KnowledgeGraphActor` shard, then caches revision-keyed query results in a `KnowledgeCacheActor`. A code-review agent requests neighbors, asks `DecisionTreeActor` which checks to run, and opens a `DecisionGateActor` on the exact commit SHA. An authorized control-plane caller supplies actual executed CI evidence and independently authenticated approval; the actor must reject zero-step checks, stale commits or stale epochs. `AgentCoordinatorActor` limits concurrent tasks, while `AgentWorkflowActor` tracks the state of one action.

See [architecture](docs/ARCHITECTURE.md), [invariants and trust boundaries](docs/INVARIANTS.md), and [example scenario](examples/repository-agent-flow.md).


## P0: executable actor-mail guest fixture (pending native compiler)

`tests/guest/agent_pipeline.ores` models **one cache actor and three workers**
(`ResearchAgent`, `AnalysisAgent`, `ExecutionAgent`). Main mediates typed
`ActorMail<String>` messages and verifies that the cache remains live for two
queries; `tests/guest/agent_pipeline.stdout` pins the exact oracle.

With a previously **built, trusted, clean** Java reference compiler checkout,
run:

```bash
export ORESLANG_COMPILER_ROOT=/absolute/path/to/oreslang-source.java
export ORESLANG_COMPILER_SHA="$(git -C "$ORESLANG_COMPILER_ROOT" rev-parse HEAD)"
node scripts/run-native-acceptance.mjs
```

The combined gate also requires `ORESLANG_DEMO_SHA` to match the clean
demo checkout's exact Git HEAD. Set it with:

```sh
export ORESLANG_DEMO_SHA="$(git rev-parse HEAD)"
```

It invokes the compiler's real `--check` mode on all 23 actor files
plus **three** guest fixtures, and also requires the Java type checker to reject
an intentionally invalid `ActorMail<String>` send with a targeted diagnostic.
All three executed guests must match byte-exact output oracles. A clean,
built compiler and dependencies remain prerequisites. See the acceptance doc
for Maven build commands. The latest hosted CI job still has no executing
steps, so this gate is **committed but not yet executed against Java**.

See [P0 native acceptance and compiler build steps](docs/P0_NATIVE_ACCEPTANCE.md).
The runner rejects missing/mismatched source revisions, missing build artifacts,
nonzero exits, timeouts and stdout drift. **Nothing in the existing Node.js
model or source-contract tests establishes native Oreslang compilation.** The
`executed` message is deliberately inert; it does not authorize or invoke tools.
Full actor-to-actor forwarding, durable recovery, sandboxing, JDK25 exact-head
evidence and five-backend parity remain unverified.

## Reference coordination, durability and interoperability

The platform design deliberately separates **knowledge, decision and execution
graphs**; it does not spawn one actor per graph entity or add a `graph actor`
language keyword. See [Distributed intelligence graph](docs/DISTRIBUTED_INTELLIGENCE_GRAPH.md).

- `reference/durable-workflow.mjs`: append-only hash-chain journal, restart
  replay, idempotency keys and fail-closed uncertain-effect reconciliation.
  The reference is **single-writer**, without distributed fencing, production
  storage hardening or native Oreslang integration.
- `reference/agent-gateway.mjs`: read-only JSON HTTP ingress with revision,
  tenant and bearer-token gates, for clients written in any language.
  It uses in-memory demo values, **not** the eight Oreslang actors.
- `contracts/v1/agent-*.schema.json`: versioned request/response contract.
  MCP, A2A, client SDKs, authenticated logical actor generation and full
  JSON Schema runtime admission remain future work.

Run the strictly labeled JavaScript-only Map-versus-serialized-queue microbenchmark via `node scripts/bench-reference.mjs`. Its figures do **not** benchmark Oreslang actors or predict production performance.

A local demonstration gateway (Node.js 22+) requires an explicit 32+ byte token
and 40-hex revision, and binds to `127.0.0.1` only:

```sh
export ORES_AGENT_DEMO_TOKEN='replace-with-a-random-secret-32-bytes-minimum'
export ORES_AGENT_DEMO_REVISION='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
node scripts/start-agent-gateway.mjs
```

Treat the token/revision above as demonstration placeholders; do not use
the sample secret in a deployment. The gateway deliberately has no write,
tool-execution or inference endpoint.

## Direct worker-to-worker mailbox fixture (native verification pending)

`tests/guest/direct_agent_hop.ores` sends an actual typed
`ActorRef<DirectAnalysisAgent>` through a research worker's mailbox. The
research worker sends its evidence **directly** to the analysis worker, using
the transferred actor reference. Main still forwards the analysis result to
the execution worker. This tests one direct hop, not the proposed
`actorA pipe actorB` operator (currently unsupported for execution).

The exact expected stdout is `evidence-ready|approved|executed`. The Java
guest launcher has **not yet run** on the new fixture. Source-only checks do
not establish mailbox correctness, physical isolation or end-to-end recovery.

## Step Functions alignment (native execution pending)

The private [step-function demo](https://github.com/ores-truffle-oreslang/oreslang-step-function-demo)
uses native Oreslang fixtures for guarded start/completion, bounded retries,
early cancellation, explicit branching, parallel fan-out/join and preview-only
review. Those fixtures are *not* a durable engine or verified native guest pass.

This branch adds a sealed `StepRunActor` with tenant/run/step identity,
activation epoch, compare-and-set version, unique attempt keys and bounded
retry count. An **uncertain** effect cannot be retried or cancelled until an
authenticated external reconciler determines the outcome; the actor itself
cannot authenticate receipt strings. `ExecutionGraphActor.cancel_blocked`
propagates failed/cancelled prerequisites only to **pending** successors.

`tests/guest/step_agent_flow.ores` is a third, older-syntax native guest
fixture that rejects premature completion, foreign-run and duplicate-start
mail, then routes research/review to a **preview-only** worker. It never
authorizes real publishing. Its exact oracle is
`agent-step:preview-complete`. Both the standalone
`scripts/run-step-native-guest.mjs` and the combined native gate must
execute the actual pinned Java compiler and exact stdout; Node structural
checks do not establish that execution.

See [Step Functions integration audit and acceptance gates](docs/STEP_FUNCTION_ALIGNMENT_20261029.md).

## Transactional inbox/outbox and native protocol (draft)

The new `WorkflowInboxOutboxActor` is **pure Oreslang source**, with
sealed in-memory state, version/epoch fencing and unique message, step,
effect and receipt IDs. Its `prepared → in_doubt → committed/not_applied`
protocol is implemented as an experimental **Node SQLite reference** using
one transaction for inbox+outbox admission and a second durable, one-shot
claim before external dispatch. Recovery never automatically resends an
`in_doubt` effect.

The local Node 22 suite passed **17/17** tests, including real subprocess
`SIGKILL` before dispatch and after a simulated external effect, plus a
two-process claim race. It also verifies external receipts **outside the
SQLite writer lock**, then rechecks epoch/version and effect identity
atomically before settlement. The provider is a test fixture; this does
**not** constitute a real remote provider, distributed durable execution
or native actor restart.

The complete native compiler manifest now includes **at least 23 actors**
(8 core, 9 memory, 6 runtime), three guest programs and a targeted
negative mailbox-type fixture. The inbox/outbox actor has **not** been
compiled, and the storage adapter is not yet connected to Oreslang.

Read [Transactional inbox/outbox security and recovery gates](docs/TRANSACTIONAL_INBOX_OUTBOX.md).

## Authenticated local workflow control (reference only)

A further hardening step adds HMAC-SHA256, short-lived, action-scoped
capabilities for the Node SQLite supervisor. `create_run`, `activate`,
`prepare_effect`, `reconcile`, `finish` and `inspect` require
a signed tenant/run/revision scope; activation must also match the current
stored epoch. Existing DB symlinks and insecure permissions are rejected.

**10/10 local Node 22 tests pass**, including a real two-process
activation race (one winner, one fenced loser), and a subprocess
`SIGKILL` after a simulated external effect commit. This remains a
single-host, experimental **reference**; the signing issuer belongs in an
independently authenticated control plane and receipt verification is
not yet integrated with a real provider. Native Oreslang actor execution
and durable restart remain unverified.

See [Capability Fencing: security contract, evidence and limitations](docs/WORKFLOW_CAPABILITY_FENCING.md).

## Workflow Supervisor and durable recovery reference (draft)

A new `WorkflowSupervisorActor` models bounded child-step admission, exact
tenant/run/revision/generation/epoch/CAS fencing, completion receipts and
in-doubt outcomes. It is a **sealed in-memory Oreslang actor protocol**.
It has no direct storage integration, authenticated tool dispatcher or
supervisor restart implementation yet.

The separate `reference/sqlite-supervisor.mjs` (experimental Node 22
`node:sqlite`) persists prepared effect intents in a local SQLite WAL and
enforces activation/version checks. Its five executed local tests include a
real subprocess SIGKILL **after a simulated external effect commits and
before local acknowledgment**; recovery queries an authoritative fixture
receipt and does not resend the effect. This is **not** a live Oreslang
test, a real third-party provider, a production authenticated lease or
multi-host exactly-once guarantee. See
[Durable supervisor implementation and recovery limitations](docs/DURABLE_WORKFLOW_SUPERVISOR.md).

Full native acceptance now discovers **at least 23** actor sources (8 core,
9 memory, 5 runtime), 3 guest programs, and 1 expected negative mailbox
typecheck; the new supervisor is a compiler-check target, **not** a fourth
executed supervisor guest.

## Native compiler gate across all actors

With an independently authorized, clean and built Java/Graal compiler checkout, set `ORESLANG_COMPILER_ROOT` and exact `ORESLANG_COMPILER_SHA`, then run `node scripts/check-native-actors.mjs`. It discovers the eight core, nine memory and five runtime actors, checks their source hashes and compiles each with `OresMain --check`, alongside guest fixtures. This gate is **not yet executed**, and a successful parse/typecheck would still not prove guest behavior or durability.

## Validation

```sh
node --test tests/*.test.mjs
```

The suite combines source-contract assertions, six JavaScript DAG/cache reference-model cases, seven independent **journal/recovery reference-model** tests (including two forced `SIGKILL` windows), four authenticated gateway tests, two protocol-schema tests and guest-runner preflight tests. These are NOT native Oreslang execution or backend parity evidence. Run results must be reported separately from GitHub runner admission.

## Userland constraints

- Native Oreslang modules/actors first; no Java-interop dependency for language semantics.
- Avoid Python tooling. `node` is used only for a dependency-free static test harness in the prototype; long-term tooling can be ported to Rust.
- No implicit `Future`/`Option` flattening or operator overloading.
- Non-reentrant actor state access; no blocking calls in handlers.
- Do not conflate declared actor isolation with proven dedicated physical heaps or OS isolation.
- No private-source transfer to an alternate GitHub organization without independent authorization.
