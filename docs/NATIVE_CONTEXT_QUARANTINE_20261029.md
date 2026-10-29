# Native Context Quarantine — Breaking Safety Migration (2026-10-29)

Status: **DRAFT**. Native Oreslang actor source only; compiler compatibility and guest execution **NOT VERIFIED**.

## Security motivation

The former native \`ContextAssemblyActor.add(..., excerpt, estimated_tokens)\` allowed any caller to provide arbitrary text and falsely declare an arbitrarily cheap token count. Its \`selected_excerpts\` API then returned that text on seal. An optional host-side signed-admission reference **cannot protect an independently callable native method**. The honest fail-closed response is to retire native raw-text ingress while an authenticated native bridge/tokenizer/runtime contract is unavailable.

## Behavioral and source breakage — intentional

The new \`ContextAssemblyActor\` is a **reference-only, untrusted manifest**:

- \`begin(task, exact_revision)\` takes two strings; previous \`begin(..., token_budget)\` callers must migrate.
- \`stage_reference(task, exact_revision, memory_id, evidence_ref)\` records up to 24 distinct **unverified** memory IDs + evidence references. It cannot store raw excerpts, token estimates, signing proofs or caller-owned arrays.
- The prior public \`add(...estimated_tokens)\` and \`remaining_budget()\` APIs are **removed**, not silently retained behind a fake authorization flag.
- \`seal(task, exact_revision)\` is one-shot; it only freezes the manifest. It is NOT verification, content admission, or proof of model-readiness.
- \`selected_ids\` and \`selected_evidence\` return fresh arrays only after seal under exact task/revision matching. The values **remain untrusted**.
- \`selected_excerpts(task, exact_revision)\` retains a compatibility signature solely to return \`Err("native excerpt publication disabled: use authenticated model ingress")\` **unconditionally**. There is no stored excerpt for it to leak.
- \`current_count(task, exact_revision)\` is scoped and read-only. Boundedness applies to **entry count**, not text size or tokens.

This is an intentionally restrictive safety patch, **not** a completed production RAG feature. Legacy call sites need conversion; the new API is not source-compatible with previous callers. Any other direct tool/model adapter that takes untrusted data is still a separate authority boundary; this patch does not prove a whole-system guarantee.

## Trusted model ingress required before re-enabling excerpts

At a privileged dispatcher not controlled by agents/models:

1. Authenticate tenant/task and require a **revocable** capability with audience for model context *data* only.
2. Pin an exact, current revision; consult the real repository/branch-head verifier.
3. Independently retrieve each memory ID and bind it to repository, revision, evidence reference and original SHA-256 digest. Never trust the manifest's receipt string as a proof.
4. Cryptographically verify dedicated-audience signed evidence (PR #18 is a **host-only reference**), enforce issuance/expiry/revocation and **durable single-use claims** across hosts. Local file locks do not establish cross-host atomic claims.
5. Use runtime-verified UTF-8 byte lengths, actual pinned **model tokenizer** and full serialized-context size. Bound memory/excerpt counts, model context window, tool/IO latency and queue concurrency. Ensure an untrusted requester cannot choose the tokenizer, verifier, token count, or model deployment configuration.
6. Produce a data-only context envelope; do not merge it into system instructions, grant tool permissions, or accept model-supplied approvals. Recheck capability/revision at actual model dispatch.
7. Keep native excerpt export **disabled** until an independently authenticated, native-facing bridge with a compiler-validated capability/effect interface has native and adversarial execution evidence.

## Acceptance matrix: pending native execution

| ID | Native guest action | Required observation |
| --- | --- | --- |
| NCA01 | Instantiate, begin with empty task or revision | False; no partial manifest |
| NCA02 | Begin valid scope, repeat begin | First true, second false |
| NCA03 | Stage reference with wrong task/revision, empty ID or evidence | All false |
| NCA04 | Add one valid reference twice | First true, duplicate false |
| NCA05 | Stage 24 distinct refs then 25th | 24 allowed, 25th rejected without partial mutation |
| NCA06 | Seal under wrong scope, then correct scope, repeat | False, true, false |
| NCA07 | Stage after seal | False |
| NCA08 | Read IDs/evidence before seal or wrong scope | Err |
| NCA09 | Read IDs/evidence after seal, then modify returned copy | Actor-owned arrays remain unchanged |
| NCA10 | Call selected_excerpts with correct and incorrect scope | Err in every case |
| NCA11 | Compile negative legacy caller using previous add(...estimated_tokens) | **Specific missing-method diagnostic**, not merely any parse failure |
| NCA12 | Compile negative legacy begin(task,revision,token_budget) caller | Arity/type diagnostic; never accepted silently |
| NCA13 | Attempt native direct actor state access outside critical loan | Targeted compiler rejection |
| NCA14 | Suspend/await across write loan or escape actor-owned array | Targeted borrow/effect rejection |
| NCA15 | Independently verified signed proof, actual tokenizer and authenticated host model dispatch | Only authorized, bounded **data** admitted; requires external bridge **NOT IMPLEMENTED** |
| NCA16 | Two hosts race same receipt across restart; sign-key revocation and stale Git head | Atomic single-use and immediate denial at dispatch; distributed store **NOT IMPLEMENTED** |

Only NCA01-NCA14 are native compiler/guest fixtures; NCA15-NCA16 require new host/effect infrastructure. All **NOT EXECUTED**. Run original source SHA native Java/GraalVM first and LLVM second, then .NET/Wasm/Forge. Preserve negative diagnostics, stdout exact oracles and actual nonzero job step counts. Source scans cannot substitute for a native compile.

## What actually passed

The committed 7-case \`tests/native-context-quarantine.test.mjs\` executed in isolated V8 with injected exact committed \`.ores\` source and repository \`auditActorSource\`; **7/7 passed**. The updated existing \`tests/memory-source-contracts.test.mjs\` executed **28/28** suites across all nine exact committed memory actor files the same way. These are source-only author-side checks, not Node CLI/TAP, Java/GraalVM, LLVM, an actual Oreslang AST, model execution or authenticated cryptography.

## CI runner diagnosis

Source-org Actions run #40921675232 on PR #18 had one \`contracts\` job with \`failure\`, **0 steps** and no retrievable job log (GitHub returned 404 BlobNotFound). The checked-in \`.github/workflows/structural-contracts.yml\` requests GitHub-hosted \`ubuntu-24.04\`, with ordinary checkout then Node tests. A failure before any steps **cannot establish** a test or Oreslang compilation regression. Verify Actions entitlement/billing/usage, organization runner policy and label availability with an appropriately authorized organization admin; check exact-head current run after access is fixed. Do not assert a root cause without admin billing/scheduler data. No private source should be mirrored to another organization absent explicit independent approval.

## Merge blockers

- Native Java sealed actor parser/loan syntax support, issue #7, unresolved.
- Source-org zero-step runner admission, issue #4, unresolved.
- Full trusted evidence-to-model bridge, signing key revocation, durable replay, exact tokenizer, privileged dispatch/capability isolation, and crash recovery, issue #9, unresolved.
- Review and migrate any native callers of the intentionally removed API, including dependent research PRs #12/#14/#15/#18 after base updates.
- Independent code/security review and executed negative tests required. **Keep draft/unmerged.**
