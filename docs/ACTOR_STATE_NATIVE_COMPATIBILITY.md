# Actor-state native compiler compatibility: blocking audit

**Verified source fact:** the draft AI coordination stack contains **20**
isolated actor implementations with one `state { ... }` schema each.
Their **99 methods** currently use the form
`return self.handle_state(critical |s| -> { ... return value; })`.
These were structurally checked, but are **not** known to compile.

The prior funded Java/Graal prototype in compiler [#1806](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1806)
requires a synchronous **void** inline callback and types the
`self.handle_state` call as `void`. It accepts
`self.handle_state(|s| -> { ... })` without the final required
`critical` permission/effect contract. Therefore **all 99** of the
value-returning call sites are incompatible with the available tested
feature baseline. A source-level check of state schema and loan count
does not validate the actor's method return typing.

A reconciled forward port is in compiler
[#2245](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2245),
still draft and **not compiled on its exact head**. It preserves the
modern compiler's current parser/runtime changes and reuses the old
implementation without silently claiming support for `critical`
or returned loan values.

## Required correction before ready or merge

1. Keep each actor's persistent fields exclusively inside one
   `state { ... }` schema.
2. Mutating code executes as a **void** callback under
   `self.handle_state(critical |s| -> { ... })`. All checks and writes
   must be in one atomic exclusive loan, with no await, runtime/LLM call,
   state reference escape or recursive state loan.
3. Publish detached results **after** the state loan has ended, using
   typed actor mailbox output/reply and the appropriate authorized
   correlation ID. An actor's user method is not cross-actor RPC.
4. If a safe detached value-returning `handle_state` variant is
   explicitly desired instead, implement and type/borrow-check it in
   the compiler and runtime **first**. Reject actor-owned collections,
   borrowed references and captured aliases from escaping that loan.
5. Add native positive and negative guest fixtures for failed state
   transitions, duplicate delivery, callback return paths, mutable
   capture, illegal suspension, nested loans, physical isolation and
   generation fencing. Run them against exact compiler and demo trees.
6. Prove compiler `critical` write permission and `with`/lexical
   `using state.write` effects. Do not silently fall back to the weaker
   noncritical #1806 prototype. Persistence needs separate WAL/outbox.

`tests/actor-loan-native-compatibility.test.mjs` is an **intentional
fail-closed gate** until these 99 incompatible methods are fixed or
a new compiler contract is demonstrated. This failure is a source-only
known incompatibility, not evidence from an executed Oreslang compiler.
