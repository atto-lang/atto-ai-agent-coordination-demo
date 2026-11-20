# Native coordination fixture

`src/plan_review.ores` now uses version-pinned task identity plus actor-owned decision state.

The primary decision gate accepts `plan:task-001@v1`, rejects an identical replay after approval, and rejects a later attempt to use the pre-decision cancellation path. Separate gates verify stale-version rejection and cancellation-before-approval behavior.

Expected stdout bytes are stored exactly in `ci/expected-output.txt`.

## Compiler-backed execution

Use the Java compiler source revision pinned in `ci/compiler-pin.env` and run:

`bash ci/verify-java.sh /path/to/oreslang-compiler`

The verifier performs `--check`, executes the guest, and byte-compares stdout against the committed oracle.

Until a real assigned runner executes that command, this repository has source and verification-contract evidence only. Zero-step Actions runs remain **NOT_EXECUTED**.

## Conformance path

`conformance/coordination_cases.json` defines the observable scenario/event pairs that Java, LLVM, WASM, .NET and Forge must each satisfy independently.

Future hardening should add durable task journals, bounded work admission, generation-safe cancellation identities, recovery/replay windows, signed or authenticated decision receipts where required, and explicit provider capability boundaries.
