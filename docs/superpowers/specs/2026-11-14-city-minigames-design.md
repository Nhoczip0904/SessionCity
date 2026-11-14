# City minigames: design

Short design (small change). Status: waiting for approval.

## Why

The city should feel alive and a bit playful. Three small things, no scoring system, no shop.

## What

### 1. Reward when a Claude session finishes
- Trigger: a session's status goes `working` -> `idle` while the page is open. `waiting` (permission prompt) does not count. Statuses seen on first load do not count, so no fake fireworks at startup.
- Effect: fireworks above that session's building; people near it jump and cheer.
- Counter in the top bar: "Hôm nay xong N phiên". Resets at local midnight (kept in `localStorage`).
- Hook point: `Actors.sync(state)` already sees `Session.status`; new small module `src/client/party.ts` holds the transition detector (pure function, unit tested) and the fireworks drawing.

### 2. Paperwork animation (office rooms only)
- In `roomDraw.ts` `station()`: the seated worker of a `working` session shuffles and flips papers on the desk and now and then stamps. `idle` sits still.
- Site and factory rooms already have jobs (`WORK_JOBS`); not touched.

### 3. Throw-a-person button (new in this round)
- New toggle button next to "Chọi đá": "Ném người". Mutually exclusive with rock mode.
- In this mode: press on a person to pick them up (same hit test as the rock, `nearestHit`), drag to carry them above the map, release to fling them on an arc (like `flyRock`) to the release point.
- Landing: snap to the nearest walkable tile, fall over, say "Ối!", get up and walk again (reuses the `down` / `ouch` code in `Actors.hit`).
- My reading of "nút để ném npc". The existing rock button only knocks people over; this one picks them up and throws them. Say so if you meant something else.

## Non-goals
Coins, shop, sounds, saving scores on the server, touching site/factory rooms.

## Approaches considered
- Reward: fireworks + counter (chosen), fireworks only (nothing lasting), coins + shop (too big for "vui vui").
- Throw: drag-and-release fling (chosen, one gesture, reuses rock code), click-to-launch with fixed distance (less fun).

## Left to the builder
Exact firework look, jump timing, the arc height and flight time (start near `rock.ts`, 600 ms).

## Tests (test first)
- Transition detector: `working->idle` fires once; `waiting->idle`, first sighting, `idle->idle` do not.
- Counter: increments, resets on a new day.
- Throw: landing tile is walkable; a person thrown onto a wall/water lands on the nearest walkable tile.
- Paperwork: pure phase function of time gives a stamp frame only when the session is `working`.
