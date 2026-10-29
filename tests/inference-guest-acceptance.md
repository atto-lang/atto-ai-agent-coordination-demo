# Native inference reservation acceptance plan (NOT EXECUTED)

Source: src/inference/inference_reservation.ores. The actor is pure Oreslang; Node is used ONLY for non-semantic source-policy tests. A production inference server is NOT included.

## Trust model and invariants
- One isolated actor instance per authenticated tenant + pinned model + exact source revision, configured only through a trusted factory. Strings supplied by a model are not identities or capabilities.
- reserve() records **trusted-adapter declared capacity units**, never measures KV cache, tokenization or allocated GPU memory. The serving backend must independently authorize and atomically bound real resources. No tool dispatch authorization is implied by a reservation ticket.
- Reserve and release are generation-CAS operations under one sealed critical loan. Counters are nonnegative; reserve checks remaining capacity with subtraction before addition, avoiding overflow. No ID reuse in the same incarnation. Tombstones cap requests at 4,096.
- Stopping admission does NOT erase live reservations; uncertain remote effects are kept reserved until authenticated reconciliation. release_verified() is a privileged adapter entrypoint **without cryptographic verification inside the actor**. It must not be reachable directly from untrusted callers.
- A crash loses the actor state. This is not durable metering, distributed quota enforcement, GPU preemption, physical isolation, exactly-once execution, nor a hard real-time scheduler.

## Required native guest scenarios (pending compiler/toolchain and runner)

| ID | Setup | Required observation |
| --- | --- | --- |
| I01 | Configure a tenant/model/revision with 2 slots, capacity 100 | Generation 1, counters 0 |
| I02 | Reserve job A at generation 1, 40 units | Ticket 1, generation 2, active 1, reserved 40 |
| I03 | Reserve job B at generation 2, 60 units | Ticket 2, generation 3, active 2, reserved 100 |
| I04 | Reserve C at generation 3 (1 unit) | Rejected, counters unchanged |
| I05 | Reserve A again, including after completion | Rejected as duplicate; tombstone retained |
| I06 | Release A with wrong ticket, tenant, model, revision, generation | All rejected; counters unchanged |
| I07 | Release A at correct CAS generation and ticket | Generation 4, active 1, reserved 60 |
| I08 | Repeat release of A | Rejected, no double refund |
| I09 | Stop accepting at generation 4 | Generation 5, phase draining; B remains reserved |
| I10 | Reserve new job after draining | Rejected; no cleanup of B |
| I11 | Release B after separately authenticated backend reconciliation | Active/reserved zero; not automatically reclaimed |
| I12 | Configure again, capacities >262144 or >64 slots | Rejected |
| I13 | 4096 distinct reservations created and released sequentially | 4097th rejected; no hidden ID recycling |
| I14 | Attempt stale generation concurrently from two requestors | Exactly one CAS succeeds |
| I15 | Model or tool response falsely reports tokens/tenant/receipt | Rejected at authenticated external adapter, never directly sent to actor |
| I16 | Kill worker before/after remote reservation/commit, restart host | Requires durable authenticated ledger/epoch; NOT IMPLEMENTED |
| I17 | Cross-tenant GPU contention, cancellation, timeout, eviction and memory isolation | Requires actual engine adapter, per-tenant quotas and measured backend memory; NOT IMPLEMENTED |

## Release gate
Run the source-only test by Node 22+ on a **trusted source-local** checkout:

    node --test tests/inference-reservation-source.test.mjs

It only checks source-structure and fixed guard text. Real native positive and negative semantics need exact-head Java/Graal and LLVM compilers, actor state loan parser/effect and borrow-checker gates, live guest traces, and zero-step CI triage. After that, test .NET/Wasm/Forge parity and real vLLM/SGLang serving with pinned model/tokenizer versions, actual GPU memory/prefill/decode usage, throughput, fairness and tail latency. No external benchmark speedup can be imported as an Oreslang result. Do not merge on static tests alone.

| I18 | Read generation, in_flight, reserved_capacity or phase with wrong tenant/model/revision | Each scoped `Result<int,String>` returns `Err`, including after draining; unauthorized handle access must separately be denied at capability boundary |

**2026-10-29 audit:** the four read APIs now take `tenant`, `model`, and `exact_revision` and return `Result<int,String>`. This is a scope equality check, not identity authentication; do not claim it prevents impersonation. `release_verified` still accepts externally asserted confirmation and is a privileged adapter-only protocol, not a validated signature or safe public method. See PR #12 `docs/AI_ML_SECURITY_AUDIT_20261029.md` for P0 blockers.
