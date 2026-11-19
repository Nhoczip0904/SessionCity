# Idle sessions leave town by train (short design)

Status: approved by user in conversation (2026-11-18).

## Intent
User asked for a rest house for idle sessions in the suburbs, with sessions travelling there by train. After discussion: no new building; idle sessions simply leave the city by train and come back by train when active again.

## Behaviour
- Session `working`/`waiting` -> `idle`: its mayor walks to the station door, waits for the next train, boards, disappears.
- Session `idle` -> `working`/`waiting`: next train stops, mayor steps off, walks to its district door.
- Idle sessions are not drawn in the city. Lists, HUD and the "home" building read server data and stay unchanged.
- Sessions already idle at load are simply absent (no trip).

## Goals / non-goals
- Goal: reuse the existing train (36 s loop in `src/client/forest.ts`) and station.
- Non-goals: new building, server changes, new dependencies, changes to other districts.

## Approaches
1. Chosen: export the train clock from `forest.ts`; actors use it to time boarding/alighting.
2. Teleport actors in/out at the station door with no timing. Simpler, but they would not meet the train.
3. New rest-house building in the forest. Rejected by user.

## Constraints
- Client only. Strict TS, ESM, `.js` import suffixes, keep each file's line endings.
- New logic gets a small test; visuals checked on a static page, not live data.

## Left to the builder
Exact walk path from the mayor's home to the station door; how the train clock is exposed; how a hidden actor is represented in `Actors`.
