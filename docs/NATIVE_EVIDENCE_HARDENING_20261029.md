# Native receipt consistency hardening

The acceptance aggregator previously accepted ten positive receipts with repeated
fixture identities or nonzero exit codes, provided their `passed` booleans were
true. It also accepted two repeated guest receipts and did not bind their source,
oracle or stdout digests to the submitted files. Counts alone were insufficient.

The aggregator now requires the exact ordered fixture inventory, individual
successful exits without signals, exact source SHA-256 digests, matching compiler
commit and tree, and guest output digests matching both checked-in stdout oracles.
The negative fixture must identify the submitted negative source, exit with a
positive error code without a signal, and carry the targeted mailbox diagnostic.
Compiler and demo source identities are checked again after the child gates.

`tests/native-evidence.test.mjs` exercises complete synthetic receipts and
adversarial stale identities, duplicates, substituted files, exit/signal failures,
missing cases, generic syntax rejection and altered stdout. Synthetic receipts
test only the validator. They do not execute Java or Oreslang.

## Evidence and limits

- Original PR #1 head: `a17f22abcbe3cb4b15814e25cd08ab717313f7aa`.
- Original root tree: `0e278ee18fef36461ed9f9b63d3930448ae84e0b`.
- All 45 original blobs were verified locally against their Git blob hashes;
  the reconstructed root tree matched exactly.
- Original host suite: 82 tests passed, no failures or skips on Node 24.
- Hardened host suite: 111 tests passed, no failures or skips on Node 24.
- These are host/reference/source-contract tests. No Java compiler or native
  Oreslang guest ran in the local audit environment (JDK17, Maven absent).

Receipts are consistency assertions from a trusted executor, not signed approval
or remote attestation. A malicious Java binary or fabricated compiler classes can
still lie. Trusted clean compiler builds, build logs and artifact provenance are
required separately. The official local runner performs a clean offline rebuild;
the direct acceptance scripts alone do not establish built-class provenance.
No protected-state runtime, durable external effects, authenticated approvals,
Native Image AOT or five-backend parity is established by this hardening.

## Authorized temporary CI replay

The user explicitly requested this task to use an alternate private organization
when source-org runner admission is blocked, by copying the exact Git tree via
the connector and building locally with the destination's own token. That current
instruction authorizes this task's temporary private test branch; it does not
authorize publication or changes to destination main.

The selected carrier must be confirmed private with recent nonzero-step runner
execution. Preserve the source as an exact subtree, verify its tree SHA and every
blob before running tests, use read-only token permissions, disable persisted
checkout credentials, and upload no private artifacts. A host-suite replay must
report its scope explicitly. Compiler compatibility and native acceptance remain
independent gates; no green host-only carrier run may promote these drafts.
