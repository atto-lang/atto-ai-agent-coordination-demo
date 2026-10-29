# AI/ML research adoption security audit — 2026-10-29

Scope: stacked research draft PR #12 (context), #14 (native inference admission), #15 (native retrieval scorecard), and inherited native agent/memory/workflow drafts #1/#2/#3/#10. Source and contract audit only: **no production approval, native compiler attestations, or GPU/LLM end-to-end runs**.

## Resolved in reviewed drafts

| Severity | Area | Finding and change | Evidence level |
| --- | --- | --- | --- |
| High | PR #12 reference/context-admission.mjs | Hostile input/proof getters or Proxy traps could cause exceptions or untrusted property reads at admission boundary. Replaced shape predicates and reads with closed descriptor-only snapshots; reject unknown keys, accessors and throwing traps. | 12 isolated V8 functional cases, mock SHA-256/UTF-8 Buffer; NOT Node crypto test |
| Medium | PR #12 reference/context-position-eval.mjs | Model output with an expected citation plus fabricated/duplicate citations was graded as grounded; accessor output could cause thrown exceptions. Reject unexpected output fields, data-accessor anomalies, malformed tool call arrays and citations absent from supplied evidence. | 6 isolated V8 cases; no actual model |
| High | PR #14 src/inference/inference_reservation.ores | Observation methods exposed tenant-specific resource counts without a tenant/model/revision scope gate. Changed all four to scoped Result read methods. | 6 committed source-policy suites, no native compiler |
| High | PR #15 src/evaluation/retrieval_scorecard.ores | Total, grounded, unsafe and generation counters could be read without tenant/run/model/corpus-revision scope. Changed all four to scoped Result reads. | 7 committed source-policy suites, no native compiler |

## P0 **NOT RESOLVED** — absolutely no production release

1. **Native context can be bypassed.** The unchanged `src/memory/context_assembly.ores` still trusts `estimated_tokens`. PR #12 is an optional host reference adapter and **does not enforce** a gate at the actor's actual entrypoint. Production use must either make the trusted ingress unavoidable or change the actor's native token/byte accounting with verified runtime primitives and tests.
2. **Authority claims are unverified.** `DecisionGateActor.record_executed_check` receives caller-provided `trusted_origin` and `passed`; `record_review` receives a boolean. `MemoryVerificationActor` and effect reconciliation likewise trust strings and booleans. PR #14 `release_verified` does not verify signatures, and PR #15 `record` does not verify grading. Tenant/revision equality is an input consistency check, **not authentication**. Require independently signed capability/CI/tool/evaluation receipts, narrow trusted adapter access, expiry/revocation, and checking at actual privileged dispatch. Never let a model choose verifier callbacks.
3. **In-memory state is not durable or fenced.** Reservation IDs, counters and evaluation receipt tombstones reset on actor restart. No stable activation epoch, monotonic cross-host fencing or durable outbox/linearizable CAS service is implemented. Unknown remote effect outcome must not be retried or released without independent authenticated reconciliation.
4. **Declared capacity units are untrusted.** PR #14 reserves `requested_units`, but does not independently measure prompt tokens, GPU KV cache, model generation, GPU memory or shared-tenant contention. `max_concurrent` is one actor's logical counter, not a per-node or per-GPU quota.
5. **Prompt injection and output safety are not solved.** A JSON `untrusted_context_data` label cannot neutralize model instructions. PR #12 position scorer never dispatches tools but can only score model callbacks; the real tool executor requires independent tool registry trust, deny-by-default permissions, signed approval, tenant isolation, and poisoned schema/description tests (see AgentDojo and MCPTox).
6. **Native compiler / runner / cross-backend evidence missing.** Existing Java sealed-state and `handle_state` effect/borrow semantics are unverified at exact integrated source head, LLVM/.NET/Wasm/Forge guests have not proven parity, and source-org Actions has returned 0-step jobs. No source-org runner budget or cross-org private source transfer is authorized merely by presence of available minutes.
7. **Limits and cancellation.** Reference verifier and model callbacks have no externally enforced wall-time/CPU/network budgets. Native actor strings accept caller data without verified UTF-8 accounting. Admission and evaluation cannot serve hostile multi-tenant ingress without transport/message body size caps, backpressure, deadlines, tenant quotas and cancellation tests.

## Required next negative tests and evidence

- **Authority:** forged/same/cross-tenant evidence receipts; caller-provided `authorized:true`; expired/revoked approvals; CI run where `steps=[]`; spoofed model registry and malicious tool descriptions.
- **State/ownership:** native compiler must reject direct actor state access, escaping state-backed arrays, write loans over suspension, and invalid message/borrow lifetimes; run actual actor workloads with verified JDK/Graal and LLVM heads.
- **Concurrency/restart:** two simultaneous reservations with the same generation; stale generation from prior activation; duplicate release; cancellation after remote commit; SIGKILL before/after effect, replay and persistent reconciliation.
- **Models/retrieval:** pin tokenizer and exact corpus/model/version; measure real first/middle/last grounding, hostile citations, bad entity provenance, stale Git HEAD, prompt injection, data exfiltration attempts, and p95 latency/cost/memory without claiming paper benchmark gains.

## Audit evidence quality

The newly edited PR #12 adapter and scorer and their committed test files were fetched by SHA, then **18/18 functional reference test callbacks passed** in isolated V8 with deliberately mocked `createHash` and UTF-8 byte-counter substitutes. This does not test Node crypto, sockets, native Oreslang or CI. The revised native actors underwent the repository's exact committed structural actor audit (zero problems each) and **6/6 / 7/7 source-only test suites**, respectively, executed in V8 with injected source/auditor, not Node TAP. Repeat on the exact PR head in a trustworthy source-local Node runtime and separately compile and run native Oreslang guests.

Source PRs must remain DRAFT, independently reviewed, and unmerged pending the blocking gates. No private code should be transferred to another organization without explicit independent security approval.
