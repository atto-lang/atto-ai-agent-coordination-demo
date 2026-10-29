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

## Sealed state and critical loans
All eight actors store persistent fields only inside one `state { ... }` schema. Reader methods use `self.handle_state(|s| -> { ... })`; writers use `self.handle_state(critical |s| -> { ... })` under explicit `with state.read, state.write` effect bounds (or `with state.write` if write-only). Direct `self` field access is forbidden. Graph edge endpoint validation and mutation happen inside the same critical state callback; there is no nested actor-state loan. No state loan may escape, suspend, or be passed to external code. Array-valued state, compiled callback returns and runtime enforcement require actual native compiler and guest tests; source-only tests are not sufficient.
