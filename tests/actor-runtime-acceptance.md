# Runtime graph / agent workflow acceptance matrix

These are **required native guest scenarios**, not tests proven to have passed. Run against pinned source tree/compiler SHA and include actual nonzero runner job steps, logs, failing diagnostics and stdout oracles.

| ID | Scenario | Expected |
| --- | --- | --- |
| R01 | Register one logical actor name | Route epoch 1 and exact current incarnation/generation accepted |
| R02 | Register duplicate logical name | Refused; cannot hijack prior identity |
| R03 | Relocate with stale expected incarnation/epoch | Refused, route unchanged |
| R04 | Relocate with fresh incarnation and new placement | Old reference fails; new reference resolves |
| R05 | Retire and send message on stale route | Route refused; no old-generation delivery |
| R06 | Add execution dependencies to earlier-declared nodes | Accepted, no forward dependency |
| R07 | Add dependency to missing node, self, duplicate or later node | Refused; graph remains acyclic |
| R08 | Start graph before sealing or with stale revision | Refused |
| R09 | Two parallel root nodes + one fan-in | Roots ready; fan-in blocked until both confirmed succeeded |
| R10 | Failed prerequisite | Dependent never reported ready |
| R11 | Duplicate task start, settle or stale revision | Refused; no double completion |
| R12 | Cancel an already running task | Refused, must use external cancellation/reconciliation |
| R13 | Prepare duplicate external effect key | Refused for all workflow/revisions |
| R14 | Dispatch same effect twice | Second refused; dispatched state 1 requires reconciliation |
| R15 | Cancel effect after dispatch | Refused; do not claim cancellation |
| R16 | Reconcile with stale epoch, wrong SHA or empty receipt | Refused |
| R17 | Reconcile once with authenticated receipt | Result state fixed; duplicate refused |
| R18 | On memory provenance mismatch | Fact never promoted to authorized tool action |
| R19 | SIGKILL after dispatch before response | **Blocked:** real WAL, outbox, remote dedup and restart not implemented |
| R20 | SIGKILL across checkpoint and migration | **Blocked:** durable snapshots, supervisor and identity restore not implemented |
| R21 | Three workers, shared hot cache, end-to-end typed scheduling | **Partially specified:** PR #1 guest fixture has main-mediated messages but unexecuted native integration |

The reference-model or source contract suites provide only narrower evidence. Never report these guest cases as passing until the real Oreslang program was compiled and executed in an authorized environment.
