# Demo validation gates

Status snapshot: 2026-10-29. This checklist is not execution evidence.

## Scope
Actor-based AI coordination bootstrap.

## Required tests
Build a native bounded actor-work guest with deterministic work admission, cancellation and completion assertions.

Record exact demo and compiler Git SHAs, compiler executable SHA-256, backend, exit codes, expected vs actual outputs, runner identity and actual CI steps. A missing compiler, pending job or zero-step GitHub Action is **NOT_EXECUTED**, not a source failure or test pass.

## Limits
README-only bootstrap, not executable actor coordination.

Use real Oreslang guests for guest claims; keep host adapters distinct. Add malformed-input, bounded-resource, stale-generation and shutdown negatives where applicable. Do not assume backend parity or production readiness. Private code may only be mirrored to separately approved private carriers with exact tree and per-blob verification and no secrets.
