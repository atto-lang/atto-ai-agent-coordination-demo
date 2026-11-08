# atto-ai-agent-coordination-demo

Actor-based coordination patterns for AI agents and distributed tasks in AttoLang.

## Demonstration focus

Actor messaging, task isolation, supervision, and coordination.

## Running the example

Inspect the checked-in source, project manifest, and workflows for supported compiler backends and actual run commands. Source files use the intended `.atto` extension for AttoLang; backend support must be confirmed rather than presumed.

## Expected verification

Examples should document their dependencies, expected output, negative/error cases, and exact compiler/runtime versions used to verify execution. Host-side tests do not establish AttoLang guest execution.

## Status

This README describes the demonstration's intended purpose. Current executable coverage and feature support should be verified against code and CI.

## AttoLang ecosystem

- [AttoLang](https://github.com/atto-lang)
- [Specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** Demonstrative actor/task orchestration for AI agents: bounded messaging, supervision, delegation and safe workflow checkpoints.

**Belongs elsewhere:** Model code belongs in atto-ml, production schedulers in runtime repos and commercial hosted orchestration in atto-co.

**Security and portability boundary:** Treat agent output as untrusted input; constrain external tool capabilities, memory/state leakage and cancellation, and never transmit lexical closures between actors.

AttoLang is the public name; preserve existing Oreslang/.ores compatibility and use canonical .atto for new portable library source. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.
