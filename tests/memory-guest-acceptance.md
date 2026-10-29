# Native memory-actor acceptance scenarios (not yet executed)

Create a compiled `.ores` guest acceptance fixture against the pinned Oreslang reference compiler. Every scenario must be verified by **executed** steps and actual assertions, not source-text matches.

| ID | Setup | Required assertion |
| --- | --- | --- |
| M01 | Ingest valid Git event twice | First ticket accepted; duplicate rejected |
| M02 | Ingestion at 512 events | 513th rejected; no partial append |
| M03 | Acknowledge wrong digest or same ticket twice | Both refused |
| M04 | Extract candidate, then finish twice | First state change accepted, repeat rejected; still unverified |
| M05 | Propose fact, resolve with stale revision | Refused; remains pending |
| M06 | Verify fact, try rejecting same ticket | Second resolution refused |
| M07 | Supersede verified fact with unverified or different-subject fact | Refused; older fact unchanged |
| M08 | Supersede with another verified same-subject fact | Old fact unavailable; new fact readable |
| M09 | Register branch head; CAS update with wrong generation | Rejected |
| M10 | Correct CAS head update | Old revision/generation false; new true |
| M11 | Exact-match index retrieval | No leakage across repository, branch or revision |
| M12 | Withdraw one read-model memory twice | First accepted; second refused; read fails |
| M13 | Recall with zero or >16 limit | Rejected |
| M14 | Stage 24 untrusted reference pairs; attempt 25th, duplicate memory ID or stale task/revision | Rejected without mutation; no raw excerpt API or estimated-token admission entrypoint |
| M15 | Seal context; attempt mutation or raw excerpt retrieval | Mutation refused, copied untrusted ID/evidence arrays remain stable; `selected_excerpts` returns `Err` even with exact task/revision |
| M16 | Duplicate aliases including A->B followed by B->A or B->C | Rejected |
| M17 | Monotonic checkpoint sequence: replay old sequence | Rejected |
| M18 | Checkpoint read with incorrect digest, scope or sequence | Rejected |
| M19 | Restart actor after external checkpoint | Needs WAL/snapshot adapter; **not implemented** |
| M20 | Publish verified fact, then supersede while another worker retrieves | Needs cross-actor versioned consistency; **not implemented** |
| M21 | LLM observation asks for privileged tool action | Must be ignored as authority at the external boundary; **not implemented** |

Expected output must bind the pinned compiler/toolchain version, exact source tree and actual execution counts. Do not report M19-M21 passing until their missing infrastructure is supplied.
