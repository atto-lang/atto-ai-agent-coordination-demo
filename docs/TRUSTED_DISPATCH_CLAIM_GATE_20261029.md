# Trusted model-data dispatch claim — source-side hardening

This stacked draft hardens the **host reference bridge**, not the native Oreslang runtime.
A valid Ed25519 *context evidence* receipt only proves a referenced excerpt under
its signed scope. It is **not** authorization to invoke a model, tool, compiler,
deployment, or external effect.

## Change

`create_trusted_manifest_dispatch` now requires a host-selected `dispatch_id`
and independently configured `claimDispatch(bound)` callback. The untrusted
native-shaped manifest cannot select the dispatch identity or the claim function.
After evidence verification, full serialized-context byte/token measurement,
revision/authorization checks, and immediately before `submitModelData`, the
host must obtain a literal `true` from the one-shot dispatch claim.

The bound input includes tenant, task, Git revision, dispatch ID, tokenizer ID,
measured bytes/tokens, and the SHA-256 of the exact serialized context. The
**storage key** for idempotency must be stable across processes for the logical
dispatch (tenant/task/revision/dispatch ID); the context hash must be stored as
an immutable value under that key. A second request, including one with a
new signed evidence receipt, must not acquire a new claim for the same logical
dispatch. A mismatched context hash must be refused, not silently overwritten.
The host claim must be atomic and durable (unique constraint / compare-and-set),
and failures or uncertain results must fail closed. The model-service request now
receives the host-selected dispatch ID and serialized context SHA-256, so a
trusted provider can enforce a stable idempotency key and detect a changed
payload. This is a request binding, **not** evidence of provider-side enforcement.

After the durable claim succeeds, the host rechecks both current revision
and policy authorization before submission. A post-claim revocation consumes
the claim and must not trigger automatic retry even if permission returns.
There is still a TOCTOU interval between that last check and network
submission: only policy verification inside the trusted model-service
dispatch boundary can close that interval authoritatively.

The test uses the existing **single-host local POSIX file claim** reference.
That does not prove multi-host linearizability, atomic authorization+submit,
actual model service idempotency, runtime capability revocation, or a native
`.ores` guest. Unknown submission outcomes deliberately block automatic
retry; an independently authenticated provider reconciliation protocol is
required for recovery.

## Negative acceptance

- Missing claim callback or invalid dispatch ID must fail at construction.
- Non-boolean claim responses must not invoke the model adapter.
- Two bridge instances with distinct valid evidence receipts and one logical
  dispatch ID must cause at most one submit.
- If the model submission result is unknown, a new bridge instance must not
  re-submit automatically.
- Enforce real host policy again at the **actual model-service boundary**, with
  KMS-backed issuer, tenant isolation, revocation, real serving tokenizer, and
  provider-confirmed receipt before promoting this to production.

## Build and release evidence

Host Node test target: `node --test tests/trusted-manifest-dispatch.test.mjs`.
The source code and tests can be audited without exporting private source to a
different organization. Hosted test execution is **NOT VERIFIED** unless an
authorized exact-head job has nonzero executed steps and retrievable logs.
Static V8 parsing is not a Node test run; no Java/Graal, LLVM, .NET, WASM or
Forge guest parity is claimed.

See demo issues #4, #7 and #9, and platform-conformance security incident #22.
Do not mirror private Git trees cross-org without independently approved
source- and destination-owner transfer authorization and privacy controls.
