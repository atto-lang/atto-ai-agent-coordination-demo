# Oreslang AI agent coordination via actors

**Status: native actor coordination fixture implemented; compiler-backed execution pending.**

This repository now contains a deterministic Oreslang actor workflow with version-pinned task identity and decision gates. The fixture covers:

- approval of the current task version;
- replay rejection after a decision is committed;
- stale-version rejection;
- unknown-plan rejection;
- cancellation before approval;
- rejection of the same plan after cancellation;
- rejection of cancellation after a decision is already committed;
- deterministic actor completion.

All mutable decision state is actor-owned.

## Verification contract

The exact expected stdout is stored in `ci/expected-output.txt`.

Run:

`bash ci/verify-java.sh /path/to/oreslang-compiler`

The intended Java compiler source revision is pinned in `ci/compiler-pin.env`. A source inspection or zero-step GitHub Actions result is not guest execution evidence.

The backend-neutral scenarios are also recorded in `conformance/coordination_cases.json` for independent Java, LLVM, WASM, .NET and Forge validation.

## Scope limits

This fixture intentionally does not call external models and does not claim persistence, a knowledge graph, policy isolation, or production authorization. Model/provider access should remain behind explicit permission boundaries and separate adapters.
