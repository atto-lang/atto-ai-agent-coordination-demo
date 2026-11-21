# Durable Workflow Supervisor: native contract + executable storage reference

Status: **draft research prototype**, 2026-10-29. This branch stacks on
[AI coordination step-functions PR #10](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/10).
It does not supply production distributed workflow durability or a compiled
Oreslang supervisor. No language-specific `graph actor` keyword is proposed.

## Two deliberately separate implementations

1. `src/runtime/workflow_supervisor.ores` is an **in-memory native Oreslang
   actor protocol** with a sealed state schema. It owns a logical tenant/run,
   exact source revision, activation generation and epoch, CAS version, phase
   and bounded child steps. All mutating operations check tenant/run/revision,
   generation, epoch and version. The terminal completion gate requires at
   least one child, *all* children verified complete and zero in-doubt children.
   Timed-out children enter an explicit unknown state; they cannot be silently
   failed, cancelled or retried. This actor does NOT persist its own state,
   authenticate receipt strings, spawn a real worker or reconstruct state
   after its process dies.
2. `reference/sqlite-supervisor.mjs` is an **independently runnable,
   experimental Node 22 SQLite-backed reference** for durable run identities
   and prepared effect intents. It is not wired into the Oreslang actor.
   It uses SQLite WAL, `synchronous=FULL`, foreign-key constraints,
   `BEGIN IMMEDIATE` write transactions, globally unique effect keys and
   receipts, and compare-and-set activation epochs/versions. When a process
   restarts, the stored effect remains **in_doubt** and must be reconciled
   by an independent trusted adapter that verifies the exact key, digest,
   decision and receipt. A `not_applied` result cannot count as completion.

## Executed failure tests and evidence boundaries

On Node.js **v22.16.0** with the experimental `node:sqlite` module,
`node --test tests/sqlite-supervisor.test.mjs` passed **5/5** cases:

- Prepare, terminate/close storage, reopen, increase epoch and reject stale
  writes from the previous activation.
- Reject stale CAS versions, duplicate effect keys, cross-tenant access and
  an adapter that rejects forged receipts.
- Prevent success when a trusted receipt reports **not_applied**.
- Force a real subprocess `SIGKILL` **after a simulated remote effect
  commits** but **before** local receipt acknowledgment; reopen SQLite,
  query the persisted external receipt, reconcile the in-doubt effect, and
  finish without writing or executing the remote operation again.
- Refuse reuse of the same receipt for two different step identities.

The exact Git blob SHAs of the executed local files equal the committed files:
`reference/sqlite-supervisor.mjs` =
`91faafd24bf66f7d7361d929c0e20e312a4bd900`;
`tests/sqlite-supervisor.test.mjs` =
`69dd93e07b2ac5937519d595c87a12c062a37998`.
Another **6/6** supervisor source contract assertions executed against
the remote Git blobs in V8, covering isolated state-loans, identity/CAS
guards, in-doubt/receipt accounting and native acceptance inventory.
These are NOT Oreslang compiler executions or native tests.

The SQLite test uses a **simulated external tool receipt file** and a
test-supplied lookup verifier; it does **not** prove an actual third-party
tool provider's idempotency, cryptographic authenticity, multi-host
exactly-once execution, cluster consensus, hardware power-loss recovery
or a live native actor restart.

## Workflow boundary requirements

A production `ores.agent.workflow` adapter still needs:
- storage-enforced exclusive activation/lease with an authenticated
  controller, expiring capability and durable actor generations; callers
  must not be allowed to invoke `activate` on another actor's workflow;
- a transactional inbox claim, deterministic workflow replay,
  schema-versioned WAL/checkpoints and outbox preparation within the SAME
  storage transaction, plus crash-tolerant snapshot compaction;
- independently authenticated receipt verification (issuer, tenant,
  exact Git tree, operation digest, effect key, remote status) outside
  actor-state critical loans and model-generated responses;
- bounded per-tenant mailboxes, bytes, CPU/GPU/model tokens, durable
  deadlines/timers, cancellation propagation and LIFO saga compensation;
- a verified recovery path for interrupted actor activation that never
  assumes an absent receipt means failure or non-application;
- hostile-store/symlink/path, concurrent writer, crash during SQLite
  transaction and real external-provider fault injection before production.

The reference's `activate` method is callable by any code with the DB
object; it is **not an authenticated cluster lease**. Its local SQLite
transactions fence callers that hold stale epochs, but not a malicious
caller that can obtain an untrusted new activation. The experimental
Node SQLite module is not recommended as a production Oreslang backend.

## Acceptance runbook

On a trusted local host with Node.js 22.16.0 or a verified compatible
`node:sqlite` release:

```sh
node --test tests/sqlite-supervisor.test.mjs
node --test tests/workflow-supervisor-source.test.mjs
```

Native acceptance additionally requires an **authorized** private compiler
checkout with GraalVM JDK 25 and offline Maven dependencies, and must use
`ORESLANG_COMPILER_ROOT`, `ORESLANG_COMPILER_SHA` and
`ORESLANG_DEMO_SHA` from exact clean Git HEADs:

```sh
node scripts/run-native-acceptance.mjs
```

This native gate now includes **at least 22 actor sources** (8 core,
9 memory, 5 runtime) plus the existing **three** native guest sources and
one negative mailbox-typing fixture. It still does NOT execute the new
supervisor as an end-to-end real guest; it is a compile-check target.
The Java compiler's sealed actor-state implementation remains an
unmerged prerequisite, and GitHub Actions runner jobs have repeatedly
failed before any test steps. Keep every stacked PR draft.
