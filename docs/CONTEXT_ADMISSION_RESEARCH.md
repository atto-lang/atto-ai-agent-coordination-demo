# Research-to-code checkpoint: secure context admission (reference boundary)

Status: **bounded Node.js reference ingress only, not native Oreslang execution**. This change is deliberately stacked on memory-pipeline PR #2; it does not replace ContextAssemblyActor or implement an AI workflow engine in JavaScript.

## Research basis and limits

- Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*, TACL 2024: https://aclanthology.org/2024.tacl-1.9/ . Larger context windows do not guarantee reliable use of evidence. Add future model evaluation with relevant passages at the start, middle and end, recording citation accuracy.
- Lewis et al., *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks*, NeurIPS 2020: https://arxiv.org/abs/2005.11401 . Pre-2021 background: retrieved information needs provenance, but is not automatically verified.
- Debenedetti et al., *AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents*, NeurIPS 2024: https://arxiv.org/abs/2406.13352 . Tool observations and retrieved content can be attacker-controlled; instruction labels are not an authorization boundary.

This adapter is a security prerequisite, **not a reproduction of any paper or a measured increase in answer quality**. It adds no RAG ranking, embeddings, model training, inference, LLM provider or vector search.

## Host-only validation contract

The host calls create_context_admission with tenant ID, task ID, an exact 40-hex Git revision, a budget <= 16,384, a pinned tokenizer ID and two **trusted host-provided** functions: countTokens(context_json) and verifyEvidence(request). Neither function may come from caller input, an LLM response, or untrusted repository text.

verifyEvidence must independently authenticate an evidence source or signed receipt, including expiry/revocation and the tenant, task, revision, memory ID, evidence ref and excerpt SHA-256. Simply returning authorized:true based on user-supplied data is not verification. The test verifier is explicitly an insecure mock.

countTokens must run the actual pinned model tokenizer. The test byte counter is **not** a real tokenizer; a tokenizer_id string does not attest a tokenizer. The callback receives the full JSON envelope, including escaping and metadata, not only excerpt text. Caller supplied estimated_tokens fields are rejected.

Each excerpt is independently measured with UTF-8 bytes and SHA-256. Limits: 4,096 UTF-8 bytes/excerpt, 65,536 bytes/final serialized context, 24 excerpts and eight outstanding async evidence checks. Malformed UTF-16, getters, symbols, inherited object shapes, invalid proof, disabled verifier, tokenizer errors and invalid token results fail closed. Duplicate memory IDs and concurrency races are checked after asynchronous evidence verification. Nothing is returned until the context is sealed; seal fails while verification is pending.

Output is labeled untrusted_context_data and serialized as JSON. **That label does not neutralize prompt injection**. It carries no tool authority.

## Integration status: still BLOCKED

The actual src/memory/context_assembly.ores actor still accepts estimated_tokens and has no native UTF-8 byte gate. This adapter does not currently invoke or protect that actor, and no production ingress or auth bridge is installed. Do not expose the actor directly to untrusted clients or call this a production safety fix. Future authorized integration should validate bytes and tokens before actor admission, restrict bypass paths, authenticate receipts and recheck source HEAD, tenant authority, cancellation and revocation at actual consumption and tool dispatch. Do not assume String.size equals UTF-8 bytes in Java, LLVM, Wasm, .NET or Forge.

Async verifier timeouts/cancellation, tenant CPU/network quotas, persistent audit trails, model-specific tokenizer, and proof service are not implemented here. Parse upstream JSON with a bounded request body. No irreversibly acting tool or autonomous workflow is enabled.

## Testing and release gates

On an approved local Node 22 clone or authorized runner, run:

    node --test tests/context-admission.test.mjs

Tests cover underreported token estimates, byte-heavy Unicode, invalid surrogates, forged tenant/revision/hash, duplicate IDs under interleaving, unbounded attestations, fail-closed tokenizer/verification results, seal immutability and an injected instruction preserved as inert data. A mock verifier and test-only byte counter are used.

Required before promotion: independently authenticated verifier; real tokenizer and position-sensitive retrieval/model quality experiments; prompt-injection and spoofing at the actual tool dispatch boundary; exact-head Actions with nonzero executed steps; native compiler/guest execution and state-loan semantics on Java/GraalVM, then LLVM/.NET/Wasm/Forge when applicable; durable cancellation, cross-tenant quotas, restart and idempotent side-effect tests. No performance improvement or language parity may be inferred from Node reference passes.

Track existing issues #4 (runner admission), #7 (native sealed-state compiler), and #9 (authority, durability and quotas). Existing PRs #1/#2/#3 have independent unmerged dependencies. Never mirror private source to another organization without explicit separate authorization. Keep this PR **DRAFT**, unmerged until independent review.
