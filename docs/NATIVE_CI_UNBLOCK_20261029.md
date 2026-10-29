# Native agent test unblock — 29 October 2026

This records two **independent** blockers, not an assumption that a failed
workflow ran compiler tests. The source demo and Java compiler are **private**.

## 1. GitHub Actions job admission — no executed steps

Observed read-only GitHub evidence:

| Repository and run | Job | Result | Executed steps |
| --- | --- | --- | --- |
| agent-coordination demo [40820085638](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/actions/runs/40820085638) | contracts 123270260779 | failure | 0 |
| Java compiler [40823542434](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/40823542434) | synthetic-smoke 123281266385 | failure | 0 |
| carrier [voxletra-e2e 40815625646](https://github.com/voxletra/voxletra-e2e/actions/runs/40815625646) | capacity 123255872582 | failure | 0 |
| carrier [agent-pontifex-daemon 39819051380](https://github.com/agent-pontifex/agent-pontifex-daemon/actions/runs/39819051380) | canary 119965094541 | failure | 0 |

The first job's log fetch returned HTTP 404 `BlobNotFound`.
At inspection time [GitHub Status](https://www.githubstatus.com/) listed Actions
operational, with no active platform-wide incident. **This does not prove the
root cause.** Billing/minutes, payment, runner labels/policy and account
restrictions require owner/admin access; the GitHub connector cannot read
those settings. Do **not** repeatedly rerun zero-step failures.

Tracked separately in [issue #4](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/issues/4).

## 2. Java compiler source-feature mismatch

Current Java compiler `main` reference inspected at SHA
`9f4f4a3b75dd4b124e8509b65a88a98213c11ab5`:
`Parser.parseActorClass` still builds ordinary field and method AST lists.
Its documented grammar lacks actor-scoped `state { ... }` and the compiler
source lacks integrated `handle_state` / `with state.read` lowering.

The eight demo actors now depend on `define isolated actor ... as`,
sealed `state { ... }`, `with state.read/state.write`, and
`self.handle_state(critical |s| -> { ... })`, with non-void callback returns.
Thus **do not expect full native acceptance against Java main**, even after
restoring runners. This is a source compatibility finding; exact compiler
diagnostics still require a real compiler run.

Compiler integration remains on draft stacks:
- Java [#1804](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1804): sealed state schema.
- Java [#1806](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1806): lexical state loans; current callback contract returns void, unlike many demo methods.
- Java [#760](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/760): separate `with/using` effect contract.
- Java [#2243](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2243): safe **rejection** of unlowered state, not implementation.

Tracked in [issue #7](https://github.com/ores-truffle-oreslang/oreslang-ai-agent-coordination-via-actors-demo/issues/7).
These branches must be deliberately reconciled, not blindly merged.

## 3. Trusted owner-local build, no GitHub-hosted Actions dependency

`scripts/run-local-native-ci.sh` accepts **already authorized local private
checkouts** of the demo and Java compiler, without GitHub API tokens, remote
Git clone, source mirroring, or CI minutes. It requires GraalVM JDK 25, Maven,
Node 22+, a prewarmed **offline** Maven dependency cache, matching exact HEAD
SHAs and clean tracked source trees. It runs `mvn -o clean package`, host
Node tests, then a native acceptance scope.

From the *demo repository* root on an authorized owner-controlled host:

```sh
export ORESLANG_COMPILER_ROOT=/absolute/path/to/oreslang-source.java
export ORESLANG_COMPILER_SHA="$(git -C "$ORESLANG_COMPILER_ROOT" rev-parse HEAD)"
export ORESLANG_DEMO_SHA="$(git rev-parse HEAD)"

# First: compiler-supported messaging smoke, independent of the sealed schema.
export ORESLANG_NATIVE_SCOPE=guest-only
bash scripts/run-local-native-ci.sh

# Later: run only on a proven integrated compiler revision implementing sealed
# actor state, lexical loans and effects. Never silently weaken this gate.
export ORESLANG_NATIVE_SCOPE=full
bash scripts/run-local-native-ci.sh
```

**Guest-only** executes both actual Oreslang guest programs with exact stdout
verification. Success must be reported solely as
`LOCAL_NATIVE_GUEST_SMOKE_RESULT`. It **does not** check the eight sealed
actor classes, actor memory isolation or durable recovery.

**Full** additionally invokes `scripts/run-native-acceptance.mjs`: ten
positive compiler checks, a targeted negative mailbox-typing check and both
guest stdout oracles. Its success marker is `LOCAL_NATIVE_CI_RESULT`.
Both modes are fail-closed and do not claim a pass without a real Java process.

The source-only preflight of this shell script and split-scope validation was
executed locally: **7/7 tests passed**, with exact local/Git SHA blob identity
for `run-local-native-ci.sh` and `local-native-ci-contract.test.mjs`.
**Neither native mode was executable in the current tool environment**, which
has Java 21, no Maven and no local private Java compiler checkout.

## 4. Remaining release requirements

A local smoke pass is one genuine milestone, not a release. Full Java compiler
state loans need AST, type/effect/borrow checking, runtime fencing and negative
tests. Then run the eight real actor sources, direct mail tests, crash/recovery
of a durable journal/outbox with authenticated receipts, and independent
LLVM/.NET/WASM/Forge conformance. Keep PRs #1–#3 in draft; no source transfer
or merge without independent authorization and review.
