# BackendCity Part 4 — rulings and deferred follow-ups

Recorded during subagent-driven execution of docs/superpowers/plans/2026-11-09-backendcity-part4.md.

## Rulings
- Ruling: IN_* indices verified by eye in Task 8 manual check, not in Task 1 — sheet too small to verify cheaply per task; costs a later index fix commit if wrong.
- Ruling: district board = 3 lines (label — sign, description, examples) — spec §4.2 lists all four fields and the wall band fits 3 lines — costs a layout tweak if the user wants 4 separate lines.
- Ruling: furniture taps that looked lost after the redraw fix were a test-method artifact (an open dialog's backdrop absorbed the next click); browser re-check with logging showed all 5 items firing — cost if wrong: occasional missed click on office furniture

## Deferred minors
- Task 2: minor (deferred): traffic.ts _city param unused (drop + update caller in Task 8)
- Task 2: minor (deferred): randomRoadTile untested; nextNode uniformity not asserted
- Task 3: minor (deferred): rest() re-runs findPath every frame if door unreachable (doors are validated walkable)
- Task 3: minor (deferred): mayor flip working→waiting finishes current wander leg before heading home
- Task 3: minor (deferred): wander tests use unseeded Math.random; no Actors integration test
- Task 4: minor (deferred): listing reads each SKILL.md fully (no 64KB cap on list path)
- Task 4: minor (deferred): TOCTOU lstat→open in readShelfItem (local single-user, low)
- Task 4: minor (deferred): store session removal does not clear skills map
- Task 4: minor (deferred): installPath not required absolute
- Task 4: minor (deferred): shelf route uses detailSession (structuredClone) just for cwd
- Task 4: minor (deferred): tests' parent walk lstats real ancestors (existence/size only, never read)
- Task 4: minor (deferred): symlink test skipped on Windows (EPERM) — strengthened assertion unexecuted here
- Task 5: minor (deferred): officeLayout working sort lacks id tie-break; done sort duplicated with fileRows
- Task 5: minor (deferred): tokenRows null only when byModel empty; no test that props avoid desks/door; status map only "Chờ bạn" tested; no RED run recorded
- Task 6: minor (deferred): shelf dialog renders empty section header when one list empty; "Không đọc được" read-error text untested
- Task 6: minor (deferred): hover labels added at prop time can be covered by later children; tile reparent pattern convoluted; seat labels may overlap chair above
- Task 7: minor (deferred): no test that pending timers don't fire after exit/switch; redraw-before-first-fetch untested
- Task 7: minor (deferred): catch path calls show() before schedule() — draw throwing loses retry
- Task 7: minor (deferred): slow fetch (>1s) + delta burst can starve office redraw
- Task 7: minor (deferred): scene.test Esc test leaks a Panel listener
- Task 8: minor (deferred): furniture silently no-op before first office fetch; reduced-motion not checked in browser (no emulation)
- Final: minor (deferred): district room mayors ordered by project, spec says startedAt (cosmetic); multi-line YAML description shows '|'/'>'; symlinked skills/ roots or installPath followed (only SKILL.md/CLAUDE.md read)
- Not verified: reduced-motion path in a browser; symlink test (skipped on Windows EPERM); Kenney indoor indices only checked by eye in the office and three district rooms
