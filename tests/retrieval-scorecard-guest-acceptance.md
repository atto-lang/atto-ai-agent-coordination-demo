# Retrieval evaluation ablations — native Oreslang acceptance (NOT EXECUTED)

Research motivation:
- Khattab et al., DSPy, ICLR 2024, https://proceedings.iclr.cc/paper_files/paper/2024/hash/f1cf02ce09757f57c3b93c0db83181e0-Abstract-Conference.html : optimize declarative pipelines against independently measured task metrics.
- Edge et al., GraphRAG, 2024, https://arxiv.org/abs/2404.16130 : graph-enhanced retrieval for global corpus questions.
- Liao et al., GraphRAG Best Practices, 2026, https://doi.org/10.3233/SSW260013 : test retriever/reranker choices component by component instead of assuming graph traversal helps.
- Liu et al., Lost in the Middle, TACL 2024, https://aclanthology.org/2024.tacl-1.9/ : test evidence position effects on grounded response accuracy.

**Implementation:** src/evaluation/retrieval_scorecard.ores is a pure-Oreslang, sealed-state actor with source-revision-scoped experiment counters. Strategies 1=exact-match, 2=graph, 3=vector, 4=hybrid. A trusted external evaluation adapter must provide gold answers, actual citation validation, per-strategy model outputs and independently authenticated receipts. This actor does not run a model, generate vector embeddings, confirm citations, compare latency or authenticate the boolean flags passed to record(). It cannot certify the safety of any privileged tool use.

Recommended experiment fixture per query: same corpus version, identical question/gold source, fixed model/prompts/tokenizer/parameters and hardware, vary only retrieval strategy; run front/middle/last positioning via PR #12's reference context-position harness, and measure answer-grounding accuracy, citation precision/recall, model refusal, attempted tool calls, first-token latency and resource cost. Do not optimize on the held-out test set or treat one metric as quality.

## Native guest acceptance matrix (all pending)

| ID | Scenario | Required result |
| --- | --- | --- |
| E01 | Configure tenant/run/model/revision, max_results=16 | Accepted once, generation=1 |
| E02 | Duplicate configure or bad 0/513 cap | Rejected |
| E03 | Record case q1 under exact strategy 1 with correct answer/citation and no tool request | Strategy 1 totals=1, grounded=1 after seal |
| E04 | Record q1 under strategy 2 with wrong citation | Strategy 2 totals=1, grounded=0 |
| E05 | Record q1 under strategy 3 proposing deploy | Strategy 3 unsafe=1 and grounded=0 |
| E06 | Record same case_id/strategy or same receipt on another case | Rejected before counters mutate |
| E07 | Record with stale generation, tenant, model, run, revision | All rejected |
| E08 | Record strategy 0 or 5 | Rejected |
| E09 | Record after max_results, seal, or duplicate seal | Rejected, counters unchanged |
| E10 | Query aggregate before seal | Err; no unsealed partial score promoted |
| E11 | Concurrent records with identical CAS generation | Exactly one accepted; monotonic generation |
| E12 | External evaluator forges citation or self-approves tool execution | **Trusted verifier/dispatch boundary** must reject, not just scorecard |
| E13 | Mismatched corpus revision, cherry-picked queries, test/training leakage | Deny or flag at independently attested test fixture admission |
| E14 | Restart after partially written scoring | Requires durable signed ledger and reconstruction, **not implemented** |
| E15 | Compare all 4 strategies with a real pinned model at 3 context positions | Requires actual model inference and honest measured results, **not executed** |

Node-only structural gate in an approved local checkout:

    node --test tests/retrieval-scorecard-source.test.mjs

This test does not parse or execute Oreslang. Release gate: exact-head native Java/Graal compiler/guest semantics, LLVM and remaining-backend parity, real model executor, per-test verified provenance, no zero-step Actions run, prompt injection at actual tool-dispatch boundary, independently authenticated grading and signed receipts. No private source exported to another org without explicit approval. **DRAFT ONLY.**
