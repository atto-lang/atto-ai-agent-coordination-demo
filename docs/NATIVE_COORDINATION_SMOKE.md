# Native coordination smoke

`src/plan_review.ores` uses two Oreslang actors with one-message handoff and deterministic termination. Expected stdout bytes: `approved:task-001` (without newline). The review actor is a *placeholder*, not an independently enforced security gate.

This is source-only evidence: there is no verified compiler run or runtime result. A passing host-only static test cannot substitute for guest execution.

Before claiming agent coordination, add actor-owned task IDs, per-task versions, bounded mailboxes, cancellation, stale-decision rejection, real policy enforcement, and adversarial tests for replay and cross-actor capability violations. Keep model/backend calls behind explicit permission boundaries. Record compiler and demo source SHAs plus exact stdout, stderr, exit status and assigned CI runner steps.
