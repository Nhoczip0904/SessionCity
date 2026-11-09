# BackendCity Part 2 — rulings and deferred follow-ups

Recorded during subagent-driven execution of docs/superpowers/plans/2026-11-09-backendcity-part2.md.

## Rulings
- Ruling: happy-dom is installed in Task 6 (its only user) rather than Task 4 — keeps each task's diff self-contained — cost if wrong: none
- Ruling: Task 5 (sprites, picking, traffic) has no unit tests; verified by build + controller browser check — rendering has no test seam in plan — cost if wrong: visual bugs caught only by eye
- Ruling: commit trailer stays "Claude Opus 5.5" for all commits (session attribution instruction) even when a subagent on another model wrote the code — cost if wrong: attribution names the controller model, not the implementer model
- Task 2: implementer DONE (suite 124/124, tsc clean); commit trailer names Sonnet 5.5 (implementer's model). Ruling: trailers naming the model that actually wrote the commit are accepted — accurate attribution — cost if wrong: mixed trailers across commits
- Ruling: spec §5.1 light gradient overlay moves into Task 5 (it was missing from the Task 4 brief) — cost if wrong: none

## Deferred minors
- Task 1: minor (deferred): 200-cut test doesn't pin prefix; empty-string fields kept (": d"); slice can split surrogate pair; districtInfo non-null assertion; district text not pinned by tests
- Task 2: minor (deferred): no test for steps before agentMeta; empty prompt overwrites lastPrompt; model string uncut; report before toolUseId dropped
- Task 3: minor (deferred): detail tests share the file-wide store (order-dependent); untested %2F/uppercase/no-store/wrong-token; malformed /api routes 404 text/plain not JSON
- Task 4: minor (deferred): loadSheets doesn't null-check resolved textures; baked root container not destroyed; cityDraw duplicates TILE; factory chimney 9 px above plot rect; no town-hall steps; north-facing facade perspective
- Task 5: minor (deferred): figure facing resets on dress(); employee hit area 16×16 overlaps stacked; >14 sessions share a house; reduced-motion read once; per-frame array/Map in Actors.update (Part 1)
- Task 6: minor (deferred): first open() network error leaves empty panel; hover card not refreshed on state change, can overlap panel; relative time doesn't tick; keydown listener never removed; XSS tests don't cover steps/report/model; throttle can give leading+trailing fetch (≥1 s apart, OK)
- Final: minor (observed live): lastPrompt can be a harness-injected user message (e.g. <task-notification>…), not the human's prompt — parse treats any user text as prompt
- Final: minor (deferred): note() endsWith("…") false positive; back to ended session shows banner over empty panel; background-agent report may be the launch message (Part 3 follow-up)
