# Coding agent memory pipeline (userland prototype)

This is a **design and actor-contract demo**, not an agent framework with completed persistence or model integration. All source code lives in `src/memory/` and uses ordinary `isoactor` declarations. No compiler feature or Java interop is presumed. An external supervisor or capability-authorized adapter orchestrates the steps below.

## Pipeline and authority separation

```text
Git/CI/docs/agent events  (external adapters; untrusted at boundary)
      |
MemoryIngestionActor         event envelope, deduplication, bounded ticket
      |
MemoryExtractionActor        candidate fact, untrusted model/parser output
      |
MemoryVerificationActor      trusted adapter records exact evidence + decision
      |             |
      |             +--> MemoryConsolidationActor (reviewed duplicate aliases)
      |
MemoryIndexActor             exact subject/repo/branch/revision -> memory IDs
      |
MemoryRetrievalActor         capability-published read model, withdrawal
      |
ContextAssemblyActor         token-estimate-bounded context excerpts with IDs
      |
Coding agent                  reads context as data, never delegated authority

MemoryInvalidationActor      compare-and-swap branch HEAD generation
MemoryCheckpointManifestActor monotonic pointers to external durable checkpoints
```

## Intended protocol (not an executable harness)

1. A trusted Git adapter obtains a commit or CI observation and computes a verified source reference and content digest. An untrusted agent observation may be ingested too, but has **no proof of correctness**.
2. Ingestion accepts a unique event ID and returns a 1-based ticket. The adapter must persist any downstream work before acknowledging the ticket. The current demo has **no durable outbox**, so the local acknowledgement is informational only.
3. A parser or language-model adapter extracts candidate claims. The extraction actor holds them as untrusted text. `finish(..., true)` means *forwarded for verification*, **not** accepted as fact.
4. The verification adapter checks evidence authenticity and exact repository/branch/revision before calling `resolve` on the verification actor. It must authenticate the caller out-of-band: a receipt ID is **not** a cryptographic proof. State: pending (0), verified (1), rejected (2), superseded (3).
5. An authorized indexer publishes *only verified, not superseded* facts to an exact-match index and read model. On later supersession, it must withdraw obsolete read-model entries. These cross-actor updates are **not atomic** in v1.
6. A retrieval caller checks `MemoryInvalidationActor.is_current(repo, branch, revision, generation)`, then asks `MemoryIndexActor.find` and `MemoryRetrievalActor.recall_ids` with the same exact scope. Before showing/acting on results, it rechecks the verification state, the branch generation and relevant authorization.
7. Context assembly collects up to 24 excerpts and tracks caller-reported token estimates within a 16,384-unit budget. It returns *separate* memory IDs, excerpts and evidence references, not a trusted instruction prompt. A real tokenizer must enforce the model's actual context limit.
8. Before an external write (merge, deploy, modify source), the decision gate independently checks current revision, valid CI execution, authenticated approval and side-effect authorization. Recheck HEAD generation at the action boundary.

## Storage and lifecycle

The memory actors are **in-memory** long-running state holders. `MemoryCheckpointManifestActor` records a monotonic reference/checksum for a snapshot previously written by a trusted external durable storage adapter; **it does not take snapshots, persist data, or restore actor state**. Restart loses this actor's own manifest unless external state is restored. No exactly-once execution, cross-actor atomicity, actor-to-actor transport, TTL, ranking/embeddings, automated summarization, multi-tenant access control, or physical memory isolation has been demonstrated.

All arrays have hard entry caps. Exhaustion currently rejects work instead of evicting; pruning would need incarnation-safe IDs, retention policy and replay-safe deduplication. Graph indexes are exact-match only. Embedding/vector retrieval, history condensation and semantic conflict resolution are future pluggable adapters, not hidden logic in these actors.

## Safety and provenance

- Model output and retrieved source text are untrusted data, not instructions or authority.
- Source references, digests, verifier receipts and token estimates are **caller-supplied claims** until independently validated by an authenticated boundary.
- Exact revision matching must distinguish Git branch tip from historical revisions; old facts may be valid for their original tree but not current HEAD.
- When an authorized actor marks a fact superseded/rejected, retrieval and caches must be invalidated; this demo does not enforce synchronous cross-actor revocation.
- CI evidence must bind source tree, run attempt, executed steps, actual results and independent approvals; zero-step jobs never count as compiler/app execution.
- A feature branch must not mirror private source to another organization just to obtain Actions minutes.

## Validation matrix

| Layer | Available now | Required next |
| --- | --- | --- |
| Source contract | Dependency-free Node static checks | Executed runner steps, source test logs |
| Syntax/type/ownership | Not verified | Compile against a pinned Oreslang Java/Graal compiler |
| Behavior | No native guest test executed | Duplicate event, stale HEAD CAS, rejected fact, supersession, withdrawn read, context budget, replay rejection |
| Durability | Local manifest reference only | WAL, transactional outbox, snapshots, crash/restart and corruption tests |
| Distribution | Single-actor local state | Authenticated transport, supervisor, activation, backpressure and cancellation |
| Parity | Not verified | Java/Graal, LLVM and .NET/Wasm conformance fixtures |

See [tests/memory-guest-acceptance.md](../tests/memory-guest-acceptance.md) for a concrete guest test matrix. These contract checks are never a substitute for running those native tests.

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
