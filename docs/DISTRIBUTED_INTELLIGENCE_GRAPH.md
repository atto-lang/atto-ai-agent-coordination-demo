# Oreslang distributed intelligence graph — implementation contract

Status: **prototype/reference model**, not an implemented distributed Oreslang service.
This design keeps graph semantics in libraries and actor lifecycle/durability as
general-purpose runtime services. Do **not** add a `graph actor` keyword yet.

## Three graphs, one actor substrate

1. **Knowledge graph:** compact entity/edge arrays or indexes owned by partition
   actors. Node IDs are logical records, not one scheduled actor per entity.
   Maintain adjacency and entity indexes, revision-pinned queries, subscriptions,
   materialized views, cache invalidation, and separately scoped tenant identities.
2. **Decision graph:** deterministic predicates, typed branch edges, merge points,
   bounded cycles and explicit evidence. The prototype `DecisionTreeActor` currently
   implements an intentionally **acyclic DAG**; bounded cycles must be a new graph
   execution abstraction with explicit hop budgets, not a silent weakening.
3. **Execution graph:** durable task instances, dependencies, bounded fan-out/fan-in,
   approvals, deadlines, cancellations, retries and compensation. Persist commands
   before external effects; reconcile unknown outcomes by authenticated receipt.

Partition actors are responsible for many logical graph nodes; actor activation is
not equivalent to graph-node allocation. Cold partitions may unload, but logical
actor identity remains stable across incarnation changes.

## Suggested package boundaries (not shipped APIs)

- `ores.agent`: identity, capabilities, lifecycle, handoff, agent budget.
- `ores.agent.graph`: typed knowledge/decision/execution graphs and indexes.
- `ores.agent.memory`: snapshot readers, hot-cache actors, cold storage adapters.
- `ores.agent.workflow`: journal, checkpoint, outbox, reservations, replay.
- `ores.agent.protocol`: schema-versioned read-only RPC, later MCP/A2A adapters.
- `ores.agent.inference`: opt-in model inference adapters, never a required graph operation.

The Java backend is the first native verification target; LLVM, .NET, WASM
and Forge require their own **executed** equivalent behavioral fixtures.

## First implementation in this PR

- `src/*.ores`: eight userland actor source prototypes (native compilation pending).
- `tests/guest/agent_pipeline.ores`: main-mediated, real-actor **intended**
  guest source with pinned stdout, not executed on the compiler yet.
- `reference/durable-workflow.mjs`: **Node.js reference state machine**
  with fsync-backed, SHA-256 chained, append-only journal and replay. Records
  BEGIN/APPROVE/INTENT/ACK/UNKNOWN/RESOLVE/FINISH/CANCEL. A pending or uncertain
  effect is NEVER blindly repeated. Its only recovery path is authoritative
  lookup by idempotency key, bound to the digest. SIGKILL and corrupted journal
  tests execute against this model, **not native Oreslang**.
- `reference/agent-gateway.mjs`: read-only HTTP JSON reference suitable for
  external TypeScript/Python clients. The caller MUST bind it to loopback, with a
  32+ byte bearer token. It admits only get_entity, neighbors, decision.next,
  workflow.status. The reference routes to in-memory demonstration objects,
  **not** live Oreslang actors.
- `contracts/v1/*`: versioned, closed JSON Schema envelope. This is a
  testable interoperability **subset**, not the full MCP/A2A transport.
  Runtime currently hand-validates selected fields; schema-validating ingress,
  schema-generated clients and protocol compatibility tests are further gates.

## Identity, safety, and graph consistency

Design actor references as `(tenant, actor_id, generation, incarnation)` with
authenticated capability tokens and fenced generation. A hot actor may be
deactivated and reactivated with the same logical `actor_id`, but stale
incarnations must never retain write authority. Backing storage must enforce
a single fenced writer; the Node.js journal is explicitly single-writer
**without distributed fencing**, and the test-token gateway is demo-only.

A cross-shard decision must pin graph version vectors plus exact artifact/source
revisions, validate them immediately before effects, and abort/revalidate on
staleness. Every effect needs a durable command identity, verified approval,
authorization decision, tenant scope and bounded budget. The probabilistic
LLM can propose data but cannot authorize execution by sending strings.

MCP/A2A should be adapters on the safe public request boundary. External
model-tool outputs and graph content are **untrusted data**, never capability
grants. Private GitHub source cannot leave its owning organization without
independent authorization, even when CI budget is unavailable.

## Benchmarks and acceptance targets (future experiments, not results)

Measure cold loading, hot cache lookup, adjacency traversal (p50/p95/p99),
memory per graph edge, mailbox pressure, tenant fairness, concurrent readers,
checkpoint time, process-kill recovery and externally observed duplicate
effects against a non-actor reference. Vary graph size, shard count, and
cross-language client concurrency. Publish exact source/build SHA, workload
generator, sample counts, errors, environment and CPU/memory budgets.
Do not claim lower latency/GC or exactly-once execution without measurement.

## Deployment exclusions

No multi-host failover, process supervision, durable directory fsync contract,
production-grade storage, verified security principal, unbounded requests,
general LLM inference or zero-GC claim is provided by these reference files.
Single-writer journal freshness checks are **not** atomic distributed CAS.
Synchronous `fsync` in the Node reference is deliberately not a recommended
Oreslang actor handler implementation: production should stage I/O off-lane
and resume with a verified acknowledgment, without parking actor carriers.
