# P0 native actor validation (draft, evidence required)

## What this verifies

The first guest fixture `tests/guest/agent_pipeline.ores` spawns:
- one long-lived `KnowledgeCacheActor` (two ordered lookups produce `1|2`),
- `ResearchAgent`, `AnalysisAgent`, `ExecutionAgent` (typed `ActorMail<String>`),
- a **main-mediated** research → analysis → execution message chain.

A second compiler-targeted fixture, `tests/guest/direct_agent_hop.ores`,
sends an `ActorRef<DirectAnalysisAgent>` to the research worker. Research then
sends `"evidence-ready"` directly to Analysis through the typed reference;
main still relays Analysis's output to the Execution worker. This is **one
worker-to-worker hop**, not an actor-pipeline operator, direct 3-stage routing,
durable delivery or remote dispatch. The new exact oracle is
`evidence-ready|approved|executed` and is still unexecuted by Java.

The final result is an **inert string receipt**: no LLM inference, file edit, network I/O, GitHub mutation or other tool side effect occurs. Main is the router; the demo does **not** demonstrate direct actor-to-actor routing, distributed coordination, authenticated policy admission, persistence or crash recovery. These remain separate milestones.

## Trusted native execution prerequisites

Use a **trusted environment authorized to access the private Java compiler** and this private demo checkout. Do not mirror either repository to another organization unless source owners separately approve the exact transfer and destination.

In a clean checkout of `ores-truffle-oreslang/oreslang-source.java` at an explicitly reviewed commit:

```bash
mvn -B -ntp -DskipTests package dependency:build-classpath \
  -Dmdep.outputFile=target/runtime-classpath.txt
```

Then, from the checked out demo root:

```bash
export ORESLANG_COMPILER_ROOT=/absolute/path/to/oreslang-source.java
export ORESLANG_COMPILER_SHA="$(git -C "$ORESLANG_COMPILER_ROOT" rev-parse HEAD)"
node scripts/run-native-guest.mjs
```

The runner requires: (1) exact 40-hex compiler source HEAD, (2) clean tracked compiler worktree, (3) `target/classes`, (4) runtime classpath, (5) source and exact stdout oracle, (6) 30-second deadline, and (7) a zero-exit guest run with byte-identical stdout. It emits `NATIVE_GUEST_RESULT` with SHA-256 identities and fails closed on missing inputs.

**Caution:** Checking Git source HEAD does not attest the Java class files were compiled from that SHA. Collect the Maven build log from the same clean checkout/run, toolchain version, complete source Git tree SHA, and verify the build and guest run are contiguous. The script does not enforce a JDK 25 toolchain on its own; record and evaluate that separately.

## Exact-head one-command native acceptance

The Java reference launcher currently implements `--check` via
`LinkedProgramRunner.validate`. The new fail-closed gate
`scripts/check-native-actors.mjs` invokes it against **all eight** `src/*.ores`
actors and **both** guest fixtures (10 positive inputs). It additionally
runs `tests/guest/negative/wrong_actor_mail_type.ores` and requires a targeted
`ActorRef.send mailbox value` type diagnostic; a nonzero parser failure alone
does not count as success. The combined gate
`scripts/run-native-acceptance.mjs` first requires an exact, clean **demo**
Git HEAD and tree, then runs compiler checks, then runs the guest stdout oracle.
It does not skip a failed actor and does not claim a native pass without
actual compiler/launcher execution.

From an authorized, trusted checkout of **both** private repositories,
build the Java compiler (prefer GraalVM/JDK 25, capture Maven and toolchain logs):

```sh
cd /path/to/oreslang-source.java
mvn -B -ntp -DskipTests package dependency:build-classpath \
  -Dmdep.outputFile=target/runtime-classpath.txt
cd /path/to/oreslang-ai-agent-coordination-via-actors-demo
export ORESLANG_COMPILER_ROOT=/path/to/oreslang-source.java
export ORESLANG_COMPILER_SHA="$(git -C "$ORESLANG_COMPILER_ROOT" rev-parse HEAD)"
export ORESLANG_DEMO_SHA="$(git rev-parse HEAD)"
node --test tests/*.test.mjs
node scripts/run-native-acceptance.mjs
```

The combined gate returns `NATIVE_CHECK_RESULT` (ten positive and one negative compiler check),
`NATIVE_GUEST_RESULT` (two executed programs and byte-exact stdout), and
`NATIVE_ACCEPTANCE_RESULT` (demo source HEAD/tree) **only after all checks
succeed**. These are distinct from host-only Node.js reference-model tests.

The SHA checks reject modified tracked source, but neither protect against a
malicious untracked compiler class file nor attest Maven provenance.
For release acceptance, require clean ephemeral build workspaces, full
source-tree hash, reviewed dependencies, JDK 25 toolchain fingerprint,
independent build logs and signed/verified evidence. Do not call Java
`--check` runtime behavior proof: only the guest execution establishes
the observed actor-mail stdout.

## Acceptance matrix

| Gate | Required evidence | Status |
| --- | --- | --- |
| JS specification/model | Exact test file blobs + executed TAP | Locally executed (reference tests, not Oreslang) |
| Native demo guest | Two Java OresMain executions: `1|2|evidence-ready|approved|executed` and `evidence-ready|approved|executed`, verified compiler build SHA | Pending |
| Eight preexisting `src/*.ores` actors | Java OresMain `--check` each actor file, both guest fixtures, plus rejection of ill-typed mailbox send | Harness committed; native checks pending |
| Actor cross-message causality | Child send/receive with real worker-to-worker routing, timeout/cancel checks | Pending (main router only) |
| Authenticated authorization | Capability checks, authenticated tool receipts, fail-closed unauthenticated instructions | Pending |
| Durable recovery reference | Node.js fsync journal replay, SIGKILL and ambiguous receipt reconciliation | Executed locally; native/distributed recovery pending |
| Production actor recovery | Fenced multi-host single writer, transactional outbox, external idempotent effect, exact native crash replay | Pending |
| JVM native image / LLVM | Exact-source guest test, matching trace or explicit unsupported result | Pending |
| .NET / WASM / Forge | Matching conformance fixtures on real engines | Pending |

## CI limitations

The most recently inspected original `contracts` job had **zero executed steps** (run 40816132873); later runs must be checked separately. That is a runner admission failure, not a compiler or test result. The repository's source-only workflow runs `node --test tests/*.test.mjs` and cannot fetch another private repository using its default `GITHUB_TOKEN`. Do not make the source-only job claim native execution.

The **reference** suite now also includes a JSON HTTP interoperability gateway and a
hash-chained Node.js workflow journal with an actual subprocess SIGKILL test.
These do not establish native Oreslang actor durability. `docs/DISTRIBUTED_INTELLIGENCE_GRAPH.md`
defines the next implementation stages and the hard separation of untrusted AI
proposals from authenticated execution policy.

The prior proof-of-concepts repository `src/patterns/39-actor-model/runtime/` supplies known Java launcher actor-message syntax; this new fixture has **not** yet been compiled or executed by Java. Do not promote draft PR #1 to ready or merge on JS test evidence.
