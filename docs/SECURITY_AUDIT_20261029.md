# AI-agent graph actor security and execution audit — 2026-10-29

Scope: draft PRs [#1](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/1) (base), [#2](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/2) (memory),
[#3](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/3) (routing/execution/effects), and relevant draft security
PRs [#5](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/5) (native evidence), [#6](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/6)
(state loan migration), [#8](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/8) (array-reference escape).
This is a **source and reference-model audit**. It does not attest native
Oreslang parser, type checker, actor runtime, crash resilience or five-backend
parity. Different branch heads can differ. Treat commit and file SHA as
mandatory evidence identifiers for any validation claim.

## Implemented hardening

| Severity | Area | Original risk | Mitigation | Remaining caveat |
| --- | --- | --- | --- | --- |
| High | HTTP gateway, PR #1 | `createServer` could bind publicly despite loopback-only description | Enforce local+remote loopback addresses on each request; bound header/body/response size and requests/socket; strict JSON/tenant/actor/revision/operation checks; generic errors | Model uses test bearer token and hardcoded demo tenant; no production identity, TLS or real actor bridge |
| High | Reference journal, PR #1 | Replay/check-then-append was racy between distinct local writer processes | Exclusive local `wx` writer lock around replay, validation and append, with fail-closed stale-lock handling | Lockfiles require manual crash recovery, not cross-host fencing/transactionality |
| High | Journal filesystem, PR #1 | Symlink file substitution, unbounded replay, missing new-file directory sync | Restrict directory and journal file type/permissions; O_NOFOLLOW on POSIX; 16MiB cap; file and directory fsync | Not proof on network/Windows filesystems; symlinked ancestor directories and power-loss semantics require more work |
| High | Reference state exposure, PR #1 | Caller could directly mutate `workflow.state` and fabricate outcomes | Private `#state` and structured-clone snapshots | The Node example still trusts its local caller for approval; no cryptographic authorization |
| High | Protocol shape, PR #1 | Unknown top-level keys/extra operation arguments and identifier-only revision schema | Match four closed operation-specific argument shapes and 40-hex Git SHA | Ingress hand-validates a subset; no full schema validator, generated SDK or MCP/A2A transport |
| High | Native evidence, PR #1 | Subprocess exit=0 alone could create false full-native pass | Require one parsed native result per gate, compiler SHA, 10 positive checks, 1 targeted negative and 2 executed guest oracles | Separate PR #5 implements stronger per-source hashes and 20-actor verification; needs integration, full guest execution pending |
| Medium | Route directory, PR #3 | Relocation accepted unchanged/regressed generation | Require next generation greater than previous, bounded to avoid overflow | In-memory placement hints, NOT authenticated durable routing or network transport |
| Medium | Memory verification, PR #2 | Same externally supplied receipt could verify multiple distinct facts | Reject reused `verification_receipts` in `resolve` | Receipt string is NOT an authenticated signature; adapter validation mandatory |
| Medium | Effect ledger, PR #3 | Same external receipt could be reused to settle multiple effects | Reject duplicate `result_receipts` in `reconcile` | Ledger is in-memory, not a WAL; receipt origin and external idempotency still unproven |

## Verification performed in this audit

- Retrieved exact GitHub blobs for gateway, journal, schema, CI wrapper, reference tests, memory verification and runtime actor files.
- **7/7** edited JavaScript modules/tests passed isolated V8 syntax parsing after removing ESM imports/shebang (syntax only).
- Executed the **exact committed gateway implementation** in V8 using mocked HTTP/Buffer: **8/8** targeted behaviors passed (allowed request, extra envelope/arguments, bad revision, nonloopback, oversized egress, hidden internal exception, bad media type). Not real sockets.
- Executed the **exact committed workflow journal implementation** in V8 using mocked filesystem and hash: **6/6** targeted state behaviors passed (recovery, private snapshot, lock denial, stale writer, unknown outcome, symlink rejection). Does not test OS fsync, O_EXCL atomicity, process crashes or real SHA-256.
- Added Node `node:test` regression cases on PR #1, and source-level guards on PRs #2/#3. GitHub Actions **still fails with zero job steps** on tested source organization runs, so no exact-head hosted Node TAP report or Java guest result is asserted.

## Critical release blockers: not solved by source-only tests

1. **Compiler integration:** current Java source `main` lacks executable sealed `state { ... }` / `self.handle_state` / effect-loan support used across the 20 actors. Reconcile Java draft #1804, #1806, #760, #2243 (fail-closed parser guard), and the agent repo's draft #6/#8; inspect callback result semantics and array escape. See [issue #7](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/issues/7).
2. **Execution admission:** exact-head GitHub-hosted `contracts` jobs repeatedly fail before the first step. Root cause (billing, runner allocation, org policies, approvals) remains **unconfirmed**. Owner-admin investigation or existing authorized local GraalVM JDK25 checkout required. See [issue #4](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/issues/4).
3. **Authority:** demo `DecisionGateActor`, `MemoryVerificationActor.resolve` and `WorkflowEffectLedgerActor.reconcile` accept caller-supplied booleans/receipts. These MUST be reachable only through an authenticated capability-verifying adapter; LLM messages, repository text, user-provided strings and HTTP callers must never grant execution rights. Current demonstration is **not a safe production control plane**.
4. **Durability:** reference journal has no inter-host single-writer fencing, linearizable database CAS, authenticated receipt verification, durable directory service, or transactional outbox. The userland Oreslang actor ledger is still in-memory. An uncertain external side effect must not automatically replay.
5. **Memory budget:** `ContextAssemblyActor` trusts a caller-supplied `estimated_tokens` instead of measuring byte/token length itself. Until native string length/tokenizer quotas are implemented and tested, this is **not a safe resource limit** against hostile excerpts.
6. **Confidentiality:** branch owner security incident [oreslang-platform-conformance#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) prohibits unauthorized private-source export/mirroring. An alternate org's minutes alone never authorize copying private Git trees.
7. **Stack consistency:** PR #2 and PR #3 must be reconciled with the newest parent commits and the separate PR #5/#6/#8 security stacks. Do not force a tree merge that silently discards parent hardening; review three-way diffs, update bases, and preserve original SHAs and test receipts.
8. **Multi-backend parity:** real Java/Graal, LLVM, .NET, WASM and Forge guest executions with matching traces and negative cases have **not** been supplied. No hard/soft real-time, zero-GC, hot-loading or distributed consistency guarantee is proven by these JavaScript models.

## Required release gating

A first **guest-only** local smoke may prove Java actor messaging without implying sealed-state correctness. Full release demands exact source HEAD/tree, a clean JDK25/Graal compiler build, type-checking **all 20 actors on the integrated compiler stack**, negative state-loan/typed-mail tests, executing both agent guest scenarios, authenticated policy and receipt origins, failure-injection including killed workers after remote commit, independent native/LLVM parity, and a protected CI run with nonzero executed job steps. Independently review PRs #1/#2/#3/#5/#6/#8; keep all as **draft, unmerged** until those gates pass.
