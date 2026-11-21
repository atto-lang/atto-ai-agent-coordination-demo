# Architecture: three graphs over isolated actors

## Knowledge graph
`KnowledgeGraphActor` owns a partition of entity IDs, labels and typed directed edges. It rejects duplicate nodes/edges, edges with unknown endpoints, and capacity overflow. The query returns a newly allocated array. A graph revision increments on each accepted mutation. There is no cross-partition transaction yet. Partitions should be selected by stable hash and managed by a future directory/supervisor.

## Decision graph
`DecisionTreeActor` stores a branch table, not executable AI-generated predicates. Callers evaluate typed conditions and pass the resulting bool along with a pinned revision. A terminal node is registered first; each branch may only refer to existing terminals or previously inserted branches, rejecting dangling edges and cycles by construction. This imposes reverse-topological insertion, and callers must still bound traversal depth. `DecisionGateActor` is **separate**: route selection cannot authorize effects.

## Execution graph
`AgentCoordinatorActor` admits bounded tasks with unique keys, and `AgentWorkflowActor` enforces forward-only phase transitions with expected version tokens. The prototype neither sends messages between actors nor records transitions durably; delivery, supervisor restarts, persisted outbox, deadlines and dedup across reactivation remain future work.

## Long-lived cache
`KnowledgeCacheActor` is owner-local and revision-pinned. Every read specifies graph ID, graph revision, and a caller-provided logical epoch. It refuses stale revision reads and expired entries. Cache activation clears old state, can only advance one fixed graph identity, and prevents switching back to stale graph versions. Expired entry slots are reused on writes, without LRU or trusted-clock guarantees. Callers must supply a trusted monotonic epoch.

## Placement / ownership
The actor instances isolate mutation and own their bounded arrays. Do not spawn one actor per graph edge or assume separate OS processes. Isolation guarantees beyond actor ownership (dedicated arenas, memory/CPU quotas, admission or sandboxing) must be independently implemented and tested in the compiler/runtime.

## Future interfaces
1. Stable logical actor ID + incarnation + generation-pinned refs.
2. Versioned graph snapshots and multi-shard read coordination.
3. Event log/outbox + checkpoint/restore + migrations and event replay.
4. Typed async agent-to-agent requests, delegation and cancellation, with bounded messages.
5. Model/tool adapters, authorization boundary, and external protocol adapters.
6. Physical actor-owned heaps/arenas across compiler backends.

These are design targets, not features the demo already implements.

## Sealed actor state and critical mutation loans

All **20 actor implementations** now declare exactly one guest-owned `state { ... }`
schema. There are no persistent ordinary instance fields and no direct
`self.<field>` reads/writes. Every synchronous actor method obtains a bounded
exclusive `self.handle_state(critical |s| -> { ... })` loan; validation,
deduplication, identity/version checks and mutations remain in **one** critical
section. Returned values are independent copies where previously specified;
none of the loan references are returned.

This is currently a **source-contract migration** to the sealed-state design
in the compiler repository's `ACTOR_FAMILIES_SEALED_STATE_V1.md`. It is **not**
proof that Java/Graal, LLVM or another backend accepts the entire source
syntax, executes the callback, enforces state borrowing, or supplies physical
actor-owned arenas. The locked section is synchronous: it contains no
`await`, network activity, actor sends, or tool/LLM calls. Do not hold an
actor-state loan across a suspension or a remote effect. Native compiler
positive and negative tests are mandatory before merging.
