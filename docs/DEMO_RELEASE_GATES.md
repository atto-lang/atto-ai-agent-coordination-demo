# Demo validation gates

Status snapshot: 2026-10-29. This checklist is not execution evidence.

## Scope

Actor-based coordination with explicit task versioning, replay protection and cancellation semantics.

## Source evidence now present

`src/plan_review.ores` implements a planner plus stateful decision gates. The committed scenarios assert:

- current-version approval;
- replay rejection after approval;
- stale-version rejection;
- unknown-plan rejection;
- pre-decision cancellation;
- rejection of approval after cancellation;
- rejection of cancellation after a committed decision;
- deterministic actor completion.

`ci/expected-output.txt` is the exact stdout oracle, `ci/verify-java.sh` is the compiler-backed verifier, and `ci/compiler-pin.env` pins the intended Java source revision.

`conformance/coordination_cases.json` records backend-neutral event sequences for Java, LLVM, WASM, .NET and Forge.

## Required evidence before promotion

Run the exact demo head with the pinned compiler and retain:

- demo commit SHA and source blob SHA;
- compiler source commit/tree and executable SHA-256;
- exact command line;
- exit status and exact stdout/stderr;
- CI run, job and assigned runner evidence.

A missing runner, skipped job or zero-step Actions run is **NOT_EXECUTED**.

Backend parity must be independently demonstrated; one passing backend cannot stand in for the others.

## Remaining limits

This is a deterministic coordination contract, not an authorization system. It does not yet provide persistent task journals, signed receipts, durable replay windows, bounded work queues, provider capability isolation, or recovery after process restart.
