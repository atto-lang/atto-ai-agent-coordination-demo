# Invariants, threats and validation limits

The prototype assumes the caller has already verified the identity of a remote worker, independent reviewer, CI provider, storage source, model, and capability grant. User-controlled LLM text, tool responses, and graph labels are **not** authority.

| Actor | Enforced by current source | Not yet enforced |
| --- | --- | --- |
| KnowledgeGraph | unique IDs, endpoint existence, 4096 nodes and 16384 edges | cross-shard snapshots, graph acyclicity, durable writes |
| KnowledgeCache | same-version reads, expiry, 1024 items | LRU eviction, trusted clocks, durability |
| DecisionTree | exact branch-table version, max 256 branches | targets exist, no cycles, policy evaluation |
| DecisionGate | zero-step checks deny, exact revision/epoch, independent approval flag, invalidation | caller/approval authentication and provenance verification |
| EvidenceLedger | unique receipt ID, positive step count, bounded append | authenticated evidence, actual CI result, tamper-proof append log |
| AgentCoordinator | max 64 active, unique task key, single settlement | safe historical-ticket recycling, durable queues, worker authentication |
| AgentWorkflow | required expected transition, forward-only, terminal state | external side-effect atomicity, durable restoration |
| AgentRegistry | unique name and matching incarnation metadata | proof of ownership of the registered capability |

## Required hardening before production
- Keep the **historical** 4096-task cap; add pruning/generation-aware recycling without permitting stale tickets.
- Use immutable schema-versioned snapshots and write-ahead event logging; restart must never silently forget a committed side effect.
- Use a real monotonic clock and a scheduler with bounded dispatch guarantees before any real-time claim.
- Authenticate CI evidence against exact head tree/SHA and independently validated workflow attempts; 0-step runs are infrastructure observations only.
- Enforce authenticated capabilities outside the model response path; human approvals must be independently verifiable.
- Ensure tool side effects use persisted idempotency keys and a transactional outbox or equivalent recoverable protocol.
- Add negative guest tests for duplicate IDs, stale versions, exhaustion, cycles, cancellation and repeated completion.
- Require Native Oreslang compilation and executed tests on Java/Graal and at least one additional backend before calling it portable.

## Validation language
A passing JS source-contract check only proves designated structural properties exist as text. It is not a parser, type-checker, behavioral unit test, CI runner-admission result, or application benchmark. Report these independently.

## Memory subsystem

Nine additional memory actors live in `src/memory/`. Their detailed limits, trust boundaries, and revision requirements are specified in [MEMORY_PIPELINE.md](MEMORY_PIPELINE.md). The memory pipeline introduces no native durability or authenticated verification. Only independently validated facts may be published to retrieval, and branch-head generation must be checked again before tool actions.
