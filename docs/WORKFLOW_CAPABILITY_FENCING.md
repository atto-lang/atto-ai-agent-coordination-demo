# Signed workflow capabilities and local activation fencing

Status: draft, October 29, 2026. Stacked on [PR #11](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/pull/11).

This iteration hardens the **Node.js 22 SQLite workflow reference only**.
It does not implement an authenticated Oreslang actor transport, production
identity provider, signed third-party tool receipt, distributed lease, or
native supervisor restart.

## Security changes

- The SQLite supervisor now **requires a verifier** on construction and a
  signed capability for **every** create, activate, prepare, reconcile,
  finish and inspect operation. Missing capabilities fail closed.
- `reference/workflow-capabilities.mjs` has separate issuer/verifier classes
  using HMAC-SHA256 with a minimum 32-byte secret and a versioned,
  domain-separated signature. Each capability binds **exact action, tenant,
  run, Git revision and any relevant epoch/version/step/effect/receipt**.
  Verification compares signatures in constant time, limits token size,
  rejects unknown claim fields, and requires expiration within five minutes.
- Activation requires a **caller-supplied, signed expected epoch**. SQLite
  `BEGIN IMMEDIATE` checks the current stored epoch and advances it exactly
  once; replayed or concurrent stale-epoch activations are rejected.
- `inspect` is also scoped and authenticated (no more unrestricted
  cross-tenant inspection). The exact revision must match the stored run.
- Opening an existing SQLite DB **refuses symlink, hardlink and insecure
  permissions** rather than following or chmod-ing an attacker-selected
  path. New files are created with exclusive `O_NOFOLLOW` creation.

## Executed evidence

On local Node.js **v22.16.0**, `node --test tests/*.test.mjs` passed
**10/10**, including the earlier five recovery/reference scenarios.
The additional five tests exercise missing/incorrect action grants, short
key rejection, token tampering, wrong-tenant and wrong-revision scope,
expiry, replayed activation, unauthorized DB reads, unsafe SQLite symlinks,
and two real concurrent OS processes attempting the same signed activation.
Only one process successfully advances the epoch.

The original SIGKILL test still kills a process after a **simulated**
external file effect commits but before local receipt acknowledgment.
Recovery uses a controlled adapter that looks up the receipt; it does
not execute the effect twice. This is real SQLite + subprocess testing
with a simulated provider, **not** production exactly-once proof.

Verified exact Git blob IDs of locally tested files:
- `reference/sqlite-supervisor.mjs` `728aa0a9ea38c7825798d6851e43c4ed2923a83a`
- `reference/workflow-capabilities.mjs` `59f04198338423290f911698e4dd4f60b24475b0`
- `tests/sqlite-supervisor.test.mjs` `5ce9ecaeb61816037602a242a2865e4f83c76dec`
- `tests/workflow-capabilities.test.mjs` `68f1252dce1fc9e38dd6b14c914c8fc18992f98e`
- `tests/workflow-activation-race.test.mjs` `69d06605b9fa4344b921523792ec1a3ee7a4b517`

## Remaining trust boundaries and blockers

The issuer **must remain in a separate trusted control plane**, protected
by an authentic identity provider and key-management system. Do not
expose the issuer or signing key to LLM agents, HTTP users, plugin tools,
untrusted actors or code that can import the module and construct a new
database instance. The test uses a hardcoded **TEST-ONLY** key and
auto-issue proxy; neither is an approved deployment design.

The `WorkflowCapabilityVerifier` checks a signature and expiration but
does **not** prove that the issuer made a correct authorization decision.
The local shared HMAC key has no KMS, rotation, revocation list, audit log,
compromise recovery or inter-host membership semantics. Its epoch CAS is
linearizable only to the extent SQLite enforces local file locking; it is
**not** a distributed storage lease or fencing token to a remote provider.
The `verify_receipt` adapter is still caller supplied and must be
authenticated independently by the trusted control plane.

The SQLite reference still lacks production-grade outbox workers,
checkpoint/snapshot replay, durability across power loss and networked
filesystems, non-idempotent compensation, schema migration and actual
GraalVM/LLVM actor integration. `node:sqlite` is experimental on
Node 22. The native `WorkflowSupervisorActor` remains a sealed-state
**source contract**: no Java compiler/guest run verified.

## Required native acceptance

Use an owner-authorized clean compiler checkout with exact Git SHA,
GraalVM JDK 25 and an integrated sealed actor-state compiler. Execute
`node scripts/run-native-acceptance.mjs` to verify the 22 actor
sources, the negative mailbox case and three guest oracles, then build
a separate native supervisor restart fixture with persistent authenticated
storage and external-effect fault injection.

Keep this branch draft, no merge without independent security review
and real nonzero-step CI evidence. Private source is not mirrored.
