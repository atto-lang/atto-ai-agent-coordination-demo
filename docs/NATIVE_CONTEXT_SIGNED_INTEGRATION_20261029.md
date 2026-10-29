# Native context quarantine + signed host ingress integration

**Status: DRAFT. No native guest compilation, actual model tokenizer, authenticated service, production tool authority, or hosted CI execution has been verified.**

This integration branch is an exact-file Git merge of:
- native Oreslang reference-only `ContextAssemblyActor` from draft PR #20 (base PR #2)
- strict context reference admission from draft PR #12
- Ed25519 signed evidence plus optional single-host local replay claim from draft PR #18

All 11 added reference/docs/test paths in PR #18's delta from PR #2 were disjoint from PR #20's seven modified native/docs/test paths. This was a two-parent merge commit retaining the actual Git ancestry and original blob SHA; it was NOT a cross-organization source copy.

## Important limitations of the integration

The **native actor** remains in `src/memory/context_assembly.ores`. It stores a maximum of 24 untrusted (memory_id, evidence_ref) pairs, does not accept token estimates or raw text, and always rejects `selected_excerpts`. It does not grant a trusted model context or tool authority.

`reference/trusted-manifest-dispatch.mjs` is a **host-only reference bridge**, not an Oreslang implementation or a validated native actor transport. Its strict input object represents the values that a *trusted actor bridge* must obtain from the sealed native actor:
`{task_id, exact_revision, memory_ids, evidence_refs}`.

Given trusted host-supplied signing keys/issuer, a trusted evidence resolver, an actual pinned model tokenizer, a durable receipt claimer, head-current and permission checks, and a tool-free model-data sender, it:

1. Snapshots own data properties only; rejects accessor, proxy, extra, sparse and duplicate records; requires 1–24 references and exact task + revision.
2. Resolves each reference independently via trusted `resolveExcerpt` callback; requires strict matching ID/reference and untrusted excerpt string.
3. Independently computes excerpt SHA-256 and verifies scope-bound, expiring, domain-separated Ed25519 signed receipts; requires `claimReceipt` and `requireDurable:true`.
4. Enforces per-excerpt UTF-8 length, total JSON UTF-8 envelope, actual host-supplied tokenizer and strict token budget using `create_context_admission`. No caller-reported estimated token count is read. **Tests use a byte-counter mock as an oracle, not a real tokenizer.**
5. Rechecks revision and independent model-data capability at the final dispatch point; sends *data-only* serialized JSON with no tool capability, no system-role privilege and no model-control instructions. One-shot dispatch cannot blindly retry an ambiguous remote outcome.

This reference bridge **does not connect to or invoke the native Oreslang actor**; an eventual trusted native transport must enforce that a caller cannot fabricate the bridge's manifest or bypass model dispatch permission checks. It cannot prevent a separate, unconstrained model endpoint from directly accepting arbitrary prompts. Rechecks are sequential, not transactional; independent state changes between checks and send remain an integration responsibility.

## Tests and required evidence

`tests/trusted-manifest-dispatch.test.mjs` covers real Node Ed25519 signatures and local filesystem replay claims, with a *synthetic* native-shaped manifest and UTF-8 byte-counter stand-in. It covers legitimate signed data-only handoff; spoofed key, issuer, audience, scope, digest and expiry; replay in independent verifier instances; stale HEAD; denied capability; budget/tokenizer failure; accessor, sparse, duplicate or mutated manifest; resolver spoofing; and unknown model outcomes.

These are **host tests, not native tests**. Execution is only established by an actual Node TAP run on the exact committed code. The source-org Actions `contracts` job has historically failed with 0 steps and this condition must be diagnosed separately. The already validated 7/7 native quarantine source-policy tests and 28/28 memory source suites remain source-only checks. No source-only test proves the compiler accepts state/effect/critical loan syntax.

## Next work, in strict order

1. In `oreslang-source.java`, resolve issue #7: implement the isolated actor state schema and its sealed borrow/effect checking, including precise error messages, with independently compiled positive/negative fixtures. Then LLVM.
2. Provide a true **native-facing, unforgeable** model context capability (not a user-supplied string/boolean or public constructor). A privileged, isolated bridge must produce sealed proof claims; only its trusted sender can call the final model endpoint. Do not re-enable raw excerpts on `ContextAssemblyActor`.
3. Pin a real tokenizer and independently measured serving-model revision; integrate genuine source-evidence issuance, key revocation, cross-host atomic receipt claims, transport authentication, timeouts and quotas.
4. Fix Actions zero-step admission with authorized source-local runner; collect exact-head nonzero steps, native compiler/guest outputs and negative diagnostics. Do not copy private source to another GitHub organization without separate approval.
5. Carry the new native contract into downstream inference (#14) and retrieval (#15) branches via exact-blob reconciliation and rebase their PR bases before merge; preserve raw-context quarantine and distinguish reference metrics from real model results.

**Release/merge blocked until independently verified.**

## Executed author-side checks and dependency reconciliation — 2026-10-29

- Retrieved the exact committed bridge and context-admission blobs; executed **10/10** custom functional smoke cases in isolated V8 using a deliberately **mocked** signature verifier and UTF-8 byte counter, covering valid one-shot data-only send, replay, scope mismatch, malformed arrays/accessors, resolver spoofing, budget failure, stale head, denied capability and unknown remote completion. This is **not** the authored Node TAP/Ed25519 integration suite or a native guest.
- Retrieved the nine memory actor files, the exact committed structural auditor and both memory source-policy suites from the merged branch. Executed **35/35** source-only cases in isolated V8. ContextAssemblyActor audit reported 6 fields, 7 methods, 3 writes, 4 reads, problems=[]. This is **not** native Oreslang execution.
- Draft PRs #14 and #15 have been restacked as merge commits with this integration branch as a parent. Their PR bases now target PR #22 and exact changed-file comparisons show only their inference/evaluation feature files; no context admission or native quarantine reversion. Both remain draft.
- Exact-head source-org Actions run #40928783411 on this integration PR, plus #40928890281 and #40928925958 on child PRs, failed with **zero job steps**. This is workflow runner/admission evidence; no code/tests ran there. Root cause needs separate authorized administrator analysis.
