# Idle Sessions Leave Town By Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session that turns `idle` walks out of the city to the station and disappears; when it turns active again it reappears at the station when the next train stops and walks home.

**Architecture:** `forest.ts` exports the train's running clock plus a pure "ms until the next stop" helper. `Actors` (`actors.ts`) reuses the existing `inside` mechanism (hidden actor, filtered out of hit tests) with `Infinity` as "away", and prepends off-grid waypoints (main road west of the city, to the station door) to paths. No server change.

**Tech Stack:** TypeScript strict ESM (`.js` import suffixes), PixiJS v8, Vitest (client tests start with `// @vitest-environment happy-dom`).

**Spec:** `docs/superpowers/specs/2026-11-18-idle-by-train-design.md`

## Global Constraints

- Client only; no new dependencies; no new building.
- Keep each file's line endings (many are CRLF).
- Do NOT commit (project rule: commit only when asked). No commit steps below.
- Reduced motion (`opts.motion === false`): no trips; idle sessions behave as before.
- Visuals are checked on a static page, never with live session data.

## Review Focus

1. Idle -> working while still walking out: must turn around and walk home, never vanish.
2. Session already idle at first `sync`: created hidden/away, no trip animation.
3. Session removed from state while away: its actor is destroyed (existing `drop`), no leak, no throw.
4. Away actors must not be pickable, knocked by rocks, or counted in stacks (existing `inside === undefined` filters).
5. Rapid idle -> working -> idle flips: ends in the right state (away), never stuck visible at off-grid coordinates.

---

### Task 1: Train clock and next-stop helper

**Files:**
- Modify: `src/client/forest.ts` (module-level clock near `trainY`; assign in `drawTrain`'s `step`, line ~304)
- Test: `test/forest.test.ts`

**Interfaces:**
- Produces: `export const trainClock: () => number` (seconds the train has run, 0 until `drawTrain` ticks)
- Produces: `export function msToNextStop(clockS: number): number` (ms from `clockS` until the next moment the train stands at the platform, i.e. second `ALIGHT_AT = 5.5` of the 36 s cycle; 0 when exactly at it)
- Produces: `export const STATION_ROUTE: { x: number; y: number }[]` tile waypoints, off-grid, from the west end of the main road to the ticket-hall door: `[{ x: -4, y: 16 }, { x: -4, y: 19 }]`
- Produces: `export const CITY_EDGE: { x: number; y: number }` = `{ x: 0, y: 16 }`, the main road's west end inside the grid

- [ ] **Step 1: Write failing tests in `test/forest.test.ts`**
  - `msToNextStop(0) === 5500`, `msToNextStop(5.5) === 0`, `msToNextStop(6) === 35500`, `msToNextStop(36 + 1) === 4500`.
  - `trainClock()` returns a number >= 0.
- [ ] **Step 2:** Run `npx vitest run test/forest.test.ts`; expect FAIL (exports missing).
- [ ] **Step 3: Implement** the four exports in `forest.ts`; in `step` set the module clock to `t` right after `t += ...`.
- [ ] **Step 4:** Run `npx vitest run test/forest.test.ts`; expect PASS.

### Task 2: Mayors leave and return by train

**Files:**
- Modify: `src/client/actors.ts` (`Actor` interface, `walk`, `sync` at lines ~372-415, `update` loop near the `inside` handling ~627 and `rest` call ~661)
- Test: `test/actors-train.test.ts` (new; model the setup on `test/actors-mascot.test.ts`, use `opts = { motion: true, rand }` with a seeded `rand`, stub nothing else)

**Interfaces:**
- Consumes: `CITY_EDGE`, `STATION_ROUTE`, `msToNextStop`, `trainClock` from `./forest.js` (Task 1)
- Produces: `Actor.exit?: boolean` (walking out to leave town)
- Behaviour contract:
  - `walk(a, to)`: if the actor is off-grid (`a.tx < 0`), path = `[...STATION_ROUTE reversed, CITY_EDGE]` then `findPath(walkable, CITY_EDGE, to)`. Otherwise unchanged.
  - `sync`, per session, when `motion` is true:
    - status `idle`, mayor just created -> set `a.inside = Infinity`, `a.c.visible = false`, place at the station door tile (`STATION_ROUTE` last point); no walk.
    - status `idle`, mayor visible and not `exit` -> `a.exit = true`; path = `findPath(walkable, current tile, CITY_EDGE)` + `STATION_ROUTE`; skip `setHome` for this session.
    - status not `idle`, `a.inside === Infinity` -> `a.inside = msToNextStop(trainClock())`; set `a.home = this.door(s.district)` and `a.wait = 0` (existing unhide + `rest` then walks home through `walk`).
    - status not `idle`, `a.exit` set (still walking out) -> `a.exit = false` and `setHome` as usual.
  - `update`: when `a.exit` and `a.path` becomes empty -> `a.exit = false; a.inside = Infinity; a.c.visible = false;` (and skip `rest`).
  - With `motion` false: unchanged behaviour (idle goes to its `home` district door).

- [ ] **Step 1: Write failing tests** in `test/actors-train.test.ts` (build `Actors` the way `actors-mascot.test.ts` does, drive `sync(state)` and `update(ms)`; read mayor state through the same accessors that file uses, or make `mayors` readable via a cast):
  - `idle session -> mayor walks out then hides`: sync working, then sync idle; `update(60_000)` in steps; assert mayor `c.visible === false` and `inside === Infinity`.
  - `idle -> working while walking out returns home`: sync idle, `update(500)`, sync working; `update(60_000)`; assert visible and path empty at the district door tile.
  - `away -> working reappears at the next stop`: from hidden state, sync working; `update(msToNextStop(trainClock()) + 1)`; assert `c.visible === true`.
  - `session idle at first sync starts hidden`: first sync with an idle session; assert hidden, `inside === Infinity`, no path.
  - `session removed while away is destroyed`: hidden mayor, sync with empty sessions; assert actor `c.destroyed`.
  - `motion false keeps old behaviour`: with `motion: false`, idle mayor stays visible and walks to the home door.
  - `CITY_EDGE is walkable`: `city.walkable[CITY_EDGE.y][CITY_EDGE.x] === true`.
- [ ] **Step 2:** Run `npx vitest run test/actors-train.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** per the behaviour contract above. Reuse `inside` (already filtered out of hit tests at lines ~524 and ~535); do not add a new hidden-state flag.
- [ ] **Step 4:** Run `npx vitest run test/actors-train.test.ts test/actors-mascot.test.ts test/forest.test.ts`; expect PASS.

### Task 3: Verify

- [ ] **Step 1:** `npx tsc --noEmit -p tsconfig.json`; expect no errors.
- [ ] **Step 2:** `npx vitest run test/actors-train.test.ts test/forest.test.ts test/actors-mascot.test.ts test/actors-rock.test.ts test/hud.test.ts`; expect all PASS.
- [ ] **Step 3:** `npm run build`; expect success. Server is untouched, so no restart needed; client needs Ctrl+Shift+R.
- [ ] **Step 4:** Check visually on a static page (fake state with one session flipping `working` / `idle`), not the live app. Report what was not verified.
