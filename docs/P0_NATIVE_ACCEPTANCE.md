# P0 native actor validation (draft, evidence required)

## What this verifies

The first executable guest fixture `tests/guest/agent_pipeline.ores` spawns:
- one long-lived `KnowledgeCacheActor` (two ordered lookups produce `1|2`),
- `ResearchAgent`, `AnalysisAgent`, `ExecutionAgent` (typed `ActorMail<String>`),
- a **main-mediated** research → analysis → execution message chain.

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

## Acceptance matrix

| Gate | Required evidence | Status |
| --- | --- | --- |
| JS specification/model | Exact test file blobs + executed TAP | Locally executed (reference tests, not Oreslang) |
| Native demo guest | Java OresMain 0 exit, exact oracle `1|2|evidence-ready|approved|executed`, verified compiler build SHA | Pending |
| Eight preexisting `src/*.ores` actors | Parser, typechecker, ownership diagnostics and real execution for each actor | Pending |
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
