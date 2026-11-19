> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/ores-truffle-oreslang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# Oreslang AI agent coordination via actors

## AttoLang naming migration (2026-11-18)

**AttoLang** is the new public name for **Oreslang**. This `ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo` repository is a legacy-named checkout. The corresponding AttoLang project for new work is [atto-lang/atto-ai-agent-coordination-demo](https://github.com/atto-lang/atto-ai-agent-coordination-demo). Do not assume that matching project names mean GitHub history, PRs, issues, code or feature completeness has been transferred. The existing project commands and implementation status below refer to this historical checkout.

The authoritative language specification is **[atto-spec](https://github.com/atto-lang/atto-spec)** (not old Oreslang README/spec prose); portable test fixtures belong in [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance), and portable libraries in [atto-common-source](https://github.com/atto-lang/atto-common-source). The evolving language contracts include canonical `.atto` source, `snake_case` callable names, `borrow!`/`take!`/`copy!`/`copy!!`/`share!`, [implicit borrowing](https://github.com/atto-lang/atto-spec/blob/main/language/implicit-argument-borrow-v1.md), [file/module `define const` with guarded one-time `os.read_env`](https://github.com/atto-lang/atto-spec/blob/main/language/file-module-const-v1.md), and [bitwise `<<<`/`>>>`/`ashr` versus stream `<<`/`>>`](https://github.com/atto-lang/atto-spec/blob/main/language/bitwise-and-stream-operators-v1.md). These are **target rules**, not automatic execution claims for this repo.

Treat historical `.ores` fixtures, `oreslang-*` commands, package IDs, ABIs and examples below as compatibility instructions until verified changes supersede them. No Python project tooling/tests; prefer Rust support tooling. Compiler/runtime support and parity require exact source SHA/tree, target/toolchain, executed positive and negative guest tests; host-only or zero-step CI is **not executed** evidence.

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
