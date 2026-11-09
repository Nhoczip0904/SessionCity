# BackendCity Part 1 — rulings and deferred follow-ups

Recorded during subagent-driven execution of docs/superpowers/plans/2026-11-09-backendcity-part1.md.

## Rulings
- Ruling: report Event uses camelCase `toolUseId` + `text` (spec §6.1); parser maps tool_result.tool_use_id → toolUseId — spec is binding — cost if wrong: one rename
- Ruling: token required on /api/* and /ws (the only routes carrying transcript data); index.html and bundle assets served without token — they contain no user data and the page needs to load to read ?token= — cost if wrong: none for data exposure
- Ruling: Part 1 art is procedural (plan T6) instead of Kenney CC0 (spec §2) — downloading packs needs user consent — cost if wrong: uglier sprites until swap
- Task 2: Ruling: ⚠️ Tailer(offset) whose offset lands exactly after "\n" drops one full line — follows brief; only hits watcher's initial tailStart backfill, losing ≤1 old line per file; watcher keeps one Tailer per file — cost if wrong: one historical event missed at startup
- Task 3: Ruling: usage Event gains messageId (assistant lines for one message repeat the same message.id+usage); store (Task 4) counts each messageId once — spec §6.1 usage event lacks it; without it tokens double-count — cost if wrong: extra field
- Task 4: Ruling: no event for >60 s without turnEnd stays "working" (spec §6.2 leaves 60 s–10 min undefined; long Bash/thinking is real work) — cost if wrong: a stuck session shows working up to 10 min
- Task 4: Ruling: lastEvent/lastActivity come from event `at` clamped to now() (fallback now() if missing/invalid); tick compares against now() — reverses my dispatch instruction; replay of hours-old history must not look "working" — cost if wrong: clock skew between file timestamps and system clock
- Task 4: Ruling: every Event carries `at` (meta/usage added in types.ts + parse.ts during T4 fix round 2) — needed for replay timing — cost if wrong: none (extra field)
- Task 5: Ruling: ⚠️ "missing ~/.claude/projects → hint line" belongs to the client (Task 6 shows a hint when there are no sessions) — spec §11 says "thành phố trống + dòng hướng dẫn" — cost if wrong: none
- Final: Ruling: declined-to-judge items (background agents' early tool_result, permission-prompt waits, mid-session cd, tool input/report not stored, ~2.25 s latency, scan cost) left for Part 2/observation — need real transcripts or are spec gaps — cost if wrong: status glitches in those cases

## Deferred minors
- Task 1: minor (deferred): classify needs the exact array from loadRules (WeakMap)
- Task 1: minor (deferred): ordering tests missing (Edit x.sql, backslash paths, notebook_path, which error thrown)
- Task 1: minor (deferred): Migrations regex needs (^|[\/]) for repo-root relative paths
- Task 1: minor (deferred): package.json npm-init noise, no engines >=20
- Task 1: minor (deferred): empty-string matcher ("command": "") still passes and matches everything
- Task 2: minor (deferred): bare catch on open turns EACCES/EMFILE/EBUSY into [] silently (only ENOENT intended)
- Task 2: minor (deferred): Buffer.concat per chunk is quadratic for a multi-MB single line
- Task 2: minor (deferred): truncate+rewrite to >= old size between polls undetected
- Task 2: minor (deferred): tests missing cross-1MiB UTF-8, empty lines, long skipFirst, offset-after-newline
- Task 3: minor (deferred): unicode-cwd test literal lacks escaped backslashes ("D:\Học" → "D:Học")
- Task 3: minor (deferred): untested odd shapes (message missing, content non-array, input null, mixed user line, title-less custom-title, parseMeta "[]")
- Task 3: minor (deferred): tool_result without string tool_use_id dropped silently
- Task 4: minor (deferred): usage-first employee has startedAt "" never corrected
- Task 4: minor (deferred): spawn with toolUseId "" stored under "" key
- Task 4: minor (deferred): removed id may be re-added later (client must handle)
- Task 4: minor (deferred): store.test.ts trailing report line asserts nothing
- Task 4: minor (deferred, flag to final review): employee auto-done on session idle then gets new tool event stays done and is removed while active (does employee activity refresh the session's lastEvent?)
- Task 4: minor (deferred): report endedAt from e.at but removal timer from now()
- Task 4: minor (deferred): meta with newer `at` doesn't advance lastEvent of an existing session
- Task 4: minor (deferred, from T5): root `tsc --noEmit` error test/store.test.ts:104 (agentId on prompt event) — vitest doesn't typecheck
- Task 5: minor (deferred): deleted files never removed from tracked map (harmless)
- Task 5: minor (deferred): --port "" / 0 silently random port
- Task 5: minor (deferred): listen EADDRINUSE prints a stack instead of one line
- Task 5: minor (deferred): Watcher.start() twice → two loops
- Task 5: minor (deferred): Buffer cast to string in send()
- Task 5: minor (deferred): no nosniff / Referrer-Policy headers
- Task 5: minor (deferred): no tests for WS 404, stop() mid-scan
- Task 5: minor (deferred): no test for ECONNRESET on reject paths; snapshot/JSON.stringify throw inside handlers uncaught
- Task 6: minor (deferred): badge.style.fill set every sync (re-rasterises Text per delta)
- Task 6: minor (deferred): per-frame allocations in actors update
- Task 6: minor (deferred): capped/finished employees vanish or respawn at HQ (visual churn)
- Task 6: minor (deferred): "+N" position inferred from walkable (shortcut comment)
- Task 6: minor (deferred): no fetch timeout / WS heartbeat; backoff resets on every open
- Task 6: minor (deferred): delta upserts applied before removed; employees of removed sessions linger in client map
- Task 6: minor (deferred): baked draw()/figure() Graphics never destroyed (bounded)
- Task 6: minor (deferred): devicePixelRatio read once; #hint intercepts hover
- Task 6: minor (deferred): path tests lack non-walkable/out-of-bounds endpoints; vite proxy port hardcoded
- Final: minor (deferred): M3 revive done employee instead of re-creating "unknown"; M6 HQ slots wrap at 14; M7 interrupted turn stays working (interrupt text unverified)
