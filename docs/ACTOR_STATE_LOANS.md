# Canonical actor-owned state / critical handle_state contract

Status: proposed source migration, not verified guest compiler acceptance.

Every stateful isolated actor in src/**/*.ores declares exactly one state { ... } schema. That single schema holds **all guest-owned persistent instance data**. Ordinary let/val instance fields are forbidden; runtime-owned mailbox and lifecycle metadata are separate and inaccessible.

Mutations declare with state.read, state.write and use self.handle_state(critical write |s| -> { ... }). Reads declare with state.read and use self.handle_state(|s| -> { ... }). Critical callbacks perform only synchronous bounded state computations. They must not await, send actor messages, call external effects, leak state-backed references, or capture the loan across a suspension.

The knowledge graph and execution graph inline endpoint/prerequisite checks within their state loans, avoiding nested self.contains / self.prerequisites_done calls and TOCTOU between a precheck and an update.

tests/actor-state-loan-source-contracts.test.mjs checks source shape only. Actual Java/Graal and LLVM guest parser/type/effect checking, physical actor-owned arenas, exclusive loan scheduling, and negative borrow-escape tests still require execution. Exactly-once external effects, durability, and fenced recovery are NOT implied by actor state ownership.

Do not advertise this as a passing .ores runtime until exact-tree compiler and guest evidence exists.
