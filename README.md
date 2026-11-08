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

## Repository ownership and migration (2026-11-08)

**AttoLang** is the current public language; this code is still maintained under `ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo` in the original Oreslang organization. Preserve working `.ores` files, repo naming and package/CLI compatibility until an independently tested change migrates them.

- **Owns:** actor-based multi-agent coordination examples, typed state and bounded test fixtures.
- **Not this repository:** managed agent hosting, model billing or privileged production access.
- **Code ownership:** [atto-lang](https://github.com/atto-lang) is the destination for language semantics, core/std, compilers, developer tools, libraries and demos. [atto-co](https://github.com/atto-co) independently owns managed infrastructure, tenancy, identity, billing and production deployments. A separate `atto-*` repo is not by itself a verified Git transfer or equivalent source tree.
- **Proposed migration, not authorization:** existing repository into `atto-lang/oreslang-ai-agent-coordination-via-actors-demo` with original name, history and numeric GitHub ID; no first-wave direct move into `atto-co`. A later production product spinout requires its own approval.

**Repository transfer playbook:** coordinate in [issue #26](https://github.com/ores-truffle-oreslang/.github/issues/26) and review [private migration draft #25](https://github.com/ores-truffle-oreslang/.github/pull/25). Capture stable numeric ID, exact head SHA/tree, PRs, releases, packages, GitHub Pages, dependencies, branch/ruleset protections, Actions runners, secrets, App/webhook grants and rollback plan. Require explicit source and target administrators plus independent security reviewer. Never export/mirror private sources as a shortcut. After an actual GitHub ownership transfer, verify unchanged ID/history/tree, re-bind security controls and run exact-head CI. A job with `steps=[]` or `steps=null` is `NOT_EXECUTED`, and host/reference results do not prove compiled AttoLang guest or production HTTP execution.
