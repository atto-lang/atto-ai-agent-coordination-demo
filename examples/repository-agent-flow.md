# Example: collaborative code-review agents

This scenario is an **API walkthrough**, not an executable fixture.

1. Start one `KnowledgeGraphActor` for `repo/oreslang-source.java`. Add entities `src/actor`, `src/http`, `test/actor`, and their `depends_on` edges.
2. Record graph revision `r`; use `KnowledgeCacheActor.activate("repo/oreslang-source.java", r)` and put version-pinned query summaries. After ingesting another edge, activate revision `r+1` to invalidate cache.
3. Register code-review agents and their incarnations in `AgentRegistryActor`; admission must *also* verify authorization externally.
4. `AgentCoordinatorActor.submit("review:commit:abc123", "review-agent-7")` yields a ticket (or explicit error). Admission is bounded and duplicate keys are rejected.
5. `DecisionTreeActor.next("requires_native_ci", true, revision)` chooses a branch. This is a route, not approval.
6. `DecisionGateActor.begin("pr/42", "abc123")` creates a new decision epoch. An authorized validator records executed CI only after steps ran; another authorized caller records independent approval.
7. `DecisionGateActor.can_commit("abc123", epoch)` is false on stale commits, stale epochs, zero-step checks, missing review, failing checks or invalidation.
8. `AgentWorkflowActor.start("merge-pr-42", "abc123")` and `advance` must use the current transition counter. Persist decisions **before** executing external writes; this demo does not supply durable storage.
9. `AgentCoordinatorActor.settle(ticket, "review-agent-7", false)` is accepted only once and only for the stored owner. This owner string is not authenticated.

A real deployment needs authenticated transport, durable state, trusted CI verification, native compiler tests and a bounded scheduler before acting on permissions or changes.
