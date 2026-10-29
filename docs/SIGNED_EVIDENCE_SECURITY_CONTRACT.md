# Signed context-evidence security contract

Status: **Ed25519 signature-verification host reference, NOT native Oreslang authorization**. Stacked on draft PR #12; this work does not alter the native actor, implement tool approval, or grant production release.

## Protocol

The reference/signed-evidence-verifier.mjs module provides create_signed_evidence_verifier() and canonical_evidence_payload(). A trusted issuer produces domain-separated Ed25519 signatures over canonical UTF-8 JSON containing version=1; audience=oreslang.context.data.v1; issuer; key_id; unique receipt_id; tenant_id; task_id; exact 40-hex Git commit; memory_id; evidence_ref; excerpt_sha256; and bounded not_before_ms/expires_at_ms.

The validity window is at most five minutes. Public keys and expected issuer are trusted host configuration, **never client/model supplied**. Only closed own-data envelopes are accepted. Verifier checks exact base64url encoding, canonical bytes, audience, issuer, signature, validity period, excerpt hash, tenant/task/revision/memory/evidence binding, and rejects one receipt ID twice in the current process.

A signed evidence receipt means the excerpt may be considered as **untrusted context data only**. This audience never grants deploy/merge, CI approval, privileged tool execution, inference reservation release, or independent reviewer approval.

A trusted integration may inject the returned verifier as the verifyEvidence callback of create_context_admission() from PR #12, with a separately trusted pinned tokenizer. The issuer and retrieval transport are not implemented. The receipt-fetch callback may access untrusted transport: the signature, not transport data, proves origin.

## Executed tests

Locally on Node.js 22.16.0 using real node:crypto Ed25519 key creation, signing and verification:

    node --test tests/signed-evidence-verifier.test.mjs

**9/9 passed, 0 failed.** Negative tests cover wrong signing key; changed signature bytes; altered tenant/task/revision/evidence/memory/digest; expired and future receipt; wrong audience and issuer; malformed or forged key ID; accessor/Proxy property attacks; replay limit exhaustion; unavailable receipt source; and canonical encoding failures.

Committed code and tested local code are exact Git blob matches:
- reference/signed-evidence-verifier.mjs — 16e774c56db077a2203fbb449a1ab5c039e9f058
- tests/signed-evidence-verifier.test.mjs — 44d026db5d62f287dec5330cd5e4dc48cae87d70

Tests are local, **NOT** exact-head hosted GitHub Actions and **NOT** native Oreslang guest tests.

## Unresolved P0 production gates

1. **Native context bypass:** Existing src/memory/context_assembly.ores on PR #2 still has public add(...estimated_tokens) that trusts the caller. A host verifier does not make native actor admission fail closed. Require an unavoidable, independently verified ingress boundary plus native UTF-8 byte/tokenizer admission and compiler/guest tests. Do not assume String.size equals UTF-8 length.
2. **Durable cross-host replay and fencing:** This reference only tracks a bounded Set of at most 4096 receipt IDs in one process. A process restart or multiple hosts can replay the same valid signature. Production needs a durable, linearizable receipt claim (issuer+receipt_id), activation epoch, cancellation and crash/restart tests; no durable storage is implemented here.
3. **Trusted key lifecycle:** Issuer/key rotation and revocation, secure signing issuance, identity mapping, transport authentication, network quotas, and independent approvals are not implemented. Key IDs are not self-authorizing.
4. **Timeouts and resource limits:** Host code must enforce deadlines and cancellation around hung receipt/tokenizer callbacks, plus byte/body and CPU limits at real ingress.
5. **Privileged tools:** A valid context receipt is not approval to execute, merge, deploy or release reserved capacity. Tool dispatch must independently verify capability, exact repo revision, executed CI evidence and side-effect authorization. Protect against prompt injection and tool-schema poisoning.
6. **Native execution and parity:** Real Java/Graal, LLVM, .NET, Wasm and Forge compiler/guest execution is unverified, and private source-org CI is failing before any steps. Private source must not be copied to another org without independent explicit authorization.

Required next: issue native acceptance fixtures with positive/negative compiler diagnostics, integrate signed verifier into an actual authenticated source-local ingest service with a real tokenizer, implement durable fenced replay claims, test double-signature replay across hosts and SIGKILL, and require nonzero-step exact-head CI plus independent review. Keep the research stack **DRAFT, unmerged**.
