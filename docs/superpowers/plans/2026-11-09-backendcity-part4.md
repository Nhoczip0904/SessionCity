# BackendCity Part 4 — Rooms, Office Furniture, Random Movement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a district building or HQ to enter a pixel room (live occupants, clickable furniture incl. a bookshelf of CLAUDE.md files and skills), and make cars/people in the city move randomly.

**Architecture:** Client gains pure modules (`roads.ts`, `rooms.ts`) tested with an injected `rand`, a `Scene` state machine that swaps the city `world` container for a room container, and drawing code checked by hand. Server gains one read-only module (`shelf.ts`) behind two token-guarded GET routes; the client never sends a path.

**Tech Stack:** TypeScript strict ESM, PixiJS v8, Vite, Vitest (+ happy-dom for DOM tests), Node ≥ 20.

**Spec:** `docs/superpowers/specs/2026-11-09-backendcity-part4-design.md`

## Global Constraints

- Branch `feat/part4` (on top of `feat/part3`). Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- All UI text Vietnamese, rendered via `textContent` / Pixi `Text` — never `innerHTML`.
- Every random choice takes `rand: () => number` (default `Math.random`).
- `prefers-reduced-motion: reduce` → no cars, no wandering, no citizens.
- Tests never read the real `~/.claude` (it holds private company transcripts); use `mkdtemp` dirs. Never modify `~/.claude/agents/*`.
- No new dependencies.
- Verify each task with `npx vitest run` and both `npx tsc --noEmit -p tsconfig.json` and `npx tsc --noEmit -p tsconfig.server.json`.

## Review Focus

1. Esc inside a room while the side panel is open → closes only the panel; second Esc leaves the room (Task 7 test).
2. Office fetch resolving after the user left or switched office must not draw anything (Task 7 test).
3. Entering/leaving rooms many times must not leak Pixi containers — the previous room container is destroyed (Task 7 test).
4. A wandering mayor whose status flips to `waiting`/`idle` walks back to the door and stops (Task 3 test of `restTarget`).
5. Shelf item ids are the only way to read a file: a path-looking or unknown id → 404, never a read (Task 4 test).

---

### Task 1: Indoor tilesheet

**Files:**
- Create: `assets/kenney/roguelike-indoors/roguelikeIndoor_transparent.png`, `assets/kenney/roguelike-indoors/License.txt` (copy from `C:\Users\nguye\AppData\Local\Temp\ri-dl\Tilesheets\roguelikeIndoor_transparent.png` and `C:\Users\nguye\AppData\Local\Temp\ri-dl\License.txt`; if missing, unzip `C:\Users\nguye\Downloads\kenney_roguelike-indoors.zip` into a new empty temp dir first)
- Modify: `ASSETS.md`, `src/client/tiles.ts`
- Test: `test/tiles.test.ts`

**Interfaces:**
- Produces: `Sheets.indoor?: (index: number) => Texture` (index = row * 27 + col, 17 px stride); constants below; `OUTFIT_CITIZEN: Outfit`.

Indoor sheet: 458×305 px, 27 cols × 18 rows, 16 px tiles with 1 px spacing. It has furniture only (no floor/wall tiles).

Constants (verify each against the sheet with a labelled contact sheet; if a tile shows something else, pick the nearest match and note it in a comment):

```ts
export const IN_CHAIR = 55, IN_DESK = 86, IN_BIG_DESK = [112, 113, 114];
export const IN_PLANT = 16, IN_CANDLE = 19, IN_PAINTING = 343, IN_ARMCHAIR = 257;
export const IN_BOOKSHELF = [478, 479, 480];      // one row, left→right
export const IN_SERVER = [241, 268];               // [top, bottom]
export const IN_LAB = [329, 330];                  // counters with bottles
export const IN_MACHINE = [392, 419];              // [top, bottom]
export const IN_MAP = [344, 345];                  // framed map, 2 wide
export const IN_WINDOW = [400, 427];               // [top, bottom]
export const IN_BED = [12, 39];                    // [top, bottom]
export const IN_LADDER = [237, 264];               // [top, bottom]
export const IN_WHITEBOARD = [371, 372];
export const IN_RUG = [232, 233, 234, 259, 260, 261]; // 3×2
export const IN_SAFE = 266, IN_CABINET = 328, IN_PHONE = 129;
```

- [ ] **Step 1: Write failing tests** in `test/tiles.test.ts`:
  - `"cuts indoor frames with 1 px spacing"`: fake loader returns 458×305 for every url → `frame(sheets.indoor!(28))` equals `{ x: 17, y: 17, w: 16, h: 16 }`.
  - `"indoor sheet failing leaves city sheets usable"`: loader rejects only the url containing `roguelikeIndoor` → result not null, `sheets.indoor` is `undefined`, `sheets.city(0)` works.
- [ ] **Step 2:** `npx vitest run test/tiles.test.ts` → FAIL.
- [ ] **Step 3:** In `loadSheets`, import the indoor png `?url`; load it in a separate try (failure → no `indoor`). Add the constants and `OUTFIT_CITIZEN` (a hair frame and an absolute shirt frame no other `OUTFIT_*` uses; no hat, no item; pick by viewing `roguelikeChar_transparent.png`). Add the pack row to `ASSETS.md` (source `https://kenney.nl/assets/roguelike-indoors`, CC0 1.0, sheet description).
- [ ] **Step 4:** Tests + both tsc → PASS.
- [ ] **Step 5:** Commit `feat: indoor tilesheet`.

---

### Task 2: Road graph and random traffic

**Files:**
- Create: `src/client/roads.ts`, `test/roads.test.ts`
- Modify: `src/client/city.ts` (export `ROAD_ROWS`, `ROAD_COLS`), `src/client/traffic.ts`

**Interfaces:**
- Produces (in `roads.ts`):
  - `interface RoadGraph { nodes: Pt[]; adj: number[][] }`
  - `roadGraph(xs: number[], ys: number[]): RoadGraph`: one node per (x, y) pair in tile-edge units, edges to grid neighbours in the same row/column.
  - `centreLines(pairs: number[]): number[]`: the second index of each 2-tile road (`[2,3,15,16]` → `[3,16]`); city graph = `roadGraph(centreLines(ROAD_COLS), centreLines(ROAD_ROWS))`.
  - `nextNode(g: RoadGraph, at: number, from: number, rand): number`: uniform among `adj[at]` without `from`; only `from` if that is the only neighbour.
  - `interface CarState { from: number; to: number; d: number; speed: number }` (`d` = tiles travelled on the current edge, `speed` = tiles/ms).
  - `spawnCar(g, rand): CarState`: random node, random neighbour, random `d` within the edge, `speed = (2 + 2 * rand()) / 1000`.
  - `stepCar(g, car, dtMs, rand): void`: advances; on reaching `to`, carries the remainder onto `nextNode(g, to, from, rand)`.
  - `carPos(g, car): { x: number; y: number; dx: number; dy: number }` (tile-edge units, direction signs).
  - `wanderTarget(walkable: boolean[][], door: Pt, radius: number, rand): Pt`: uniform over walkable tiles with Manhattan distance ≤ radius from `door`; none → `door`.
  - `randomRoadTile(walkable, rand): Pt`.
- `Traffic` constructor gains a last param `rand = Math.random`; `COUNT = 6`.

- [ ] **Step 1: Failing tests** (`test/roads.test.ts`, seeded `rand` such as a mulberry32 helper in the test):
  - `"city graph has 4×3 intersections"`: `roadGraph([3,16,32,45],[3,16,29]).nodes.length === 12`; corner node has 2 neighbours, middle node 4.
  - `"nextNode never turns back when there is a choice"`: for every node and every neighbour `from`, 200 draws never return `from` when `adj[at].length > 1`, and always return a member of `adj[at]`.
  - `"dead end turns back"`: graph from `roadGraph([0],[0,5])` → `nextNode(g,1,0,rand) === 0`.
  - `"cars stay on centre lines"`: 6 cars, 5 000 steps of 16 ms → every `carPos` has `x ∈ xs` or `y ∈ ys`, and lies within the bounding box; every `speed` in `[0.002, 0.004]`.
  - `"wanderTarget stays near the door on a road"`: 500 draws on a small grid → walkable and Manhattan ≤ 3; grid with no walkable tile in range → returns `door`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `roads.ts`; rewrite `Traffic.update` to use `stepCar`/`carPos` (sprite choice by `dx`/`dy` as today).
- [ ] **Step 4:** Tests + tsc → PASS.
- [ ] **Step 5:** Commit `feat: random traffic over the road grid`.

---

### Task 3: Wandering workers and citizens

**Files:**
- Modify: `src/client/actors.ts`
- Test: `test/actors-wander.test.ts`

**Interfaces:**
- Consumes: `wanderTarget`, `randomRoadTile` (Task 2), `OUTFIT_CITIZEN` (Task 1), `findPath`.
- Produces:
  - `export function restTarget(home: Pt, wander: boolean, walkable: boolean[][], rand): Pt`: `wander` false → `home`; else `wanderTarget(walkable, home, 3, rand)`.
  - `Actors` constructor gains a last param `opts: { motion: boolean; rand: () => number } = { motion: !matchMedia("(prefers-reduced-motion: reduce)").matches, rand: Math.random }`.

Behaviour: `Actor` gains `home?: Pt`, `wander: boolean`, `wait: number` (ms). `sync` sets `home` = district door (a new home → path there, `wait = 0`); `wander` = `opts.motion && (employee || mayor.status === "working")`. In `update`, an actor with an empty path: if `!wander` and not on `home` → path to `home`; if `wander` → count down `wait`, then path to `restTarget(...)`, `wait = 1000 + 3000 * rand()`. 5 citizens (when `motion`): `eventMode = "none"`, no label, `OUTFIT_CITIZEN` (procedural fallback: grey `figure`), path to `randomRoadTile`, then wait 1–4 s, repeat. Citizens are not in `mayors`/`staff`.

- [ ] **Step 1: Failing tests:** `"restTarget without wander is home"`; `"restTarget with wander stays within 3 of home on a road"` (500 draws on a cross-shaped grid).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as described.
- [ ] **Step 4:** Tests + tsc → PASS.
- [ ] **Step 5:** Commit `feat: workers wander near their district, citizens stroll`.

---

### Task 4: Bookshelf API (server)

**Files:**
- Create: `src/server/shelf.ts`, `test/shelf.test.ts`
- Modify: `src/shared/types.ts`, `src/server/store.ts`, `src/server/http.ts`, `src/server/main.ts`, `test/store.test.ts`, `test/http.test.ts`

**Interfaces:**
- `src/shared/types.ts`:
  ```ts
  export interface ShelfFile { id: string; scope: "user" | "project" | "local"; path: string; size: number }
  export interface ShelfSkill { id: string; scope: "user" | "project" | "plugin"; plugin?: string; name: string; description: string; used: boolean }
  export interface Shelf { files: ShelfFile[]; skills: ShelfSkill[] }
  ```
- `shelf.ts`:
  - `listShelf(cwd: string | undefined, claudeDir: string, used: string[]): Promise<Shelf>`
  - `readShelfItem(cwd: string | undefined, claudeDir: string, id: string): Promise<{ text: string; truncated: boolean } | null>` (`null` = unknown id).
  - `shelfId(absPath: string): string` = first 16 hex chars of sha256.
- `Store.skillsUsed(sessionId: string): string[]` — names from `tool` events with `name === "Skill"` and string `input.skill`, unique, mayor or employee.
- `startServer` opts gain `claudeDir: string`; `main.ts` passes `join(homedir(), ".claude")`.
- Routes (GET, token): `/api/session/:id/shelf` → `Shelf`; `/api/session/:id/shelf/:itemId` → `{ text, truncated }`. Unknown session or item → 404 `{ error: "not found" }`. `itemId` must match `/^[0-9a-f]{16}$/` before any lookup, else 404.

Sources, order and rules exactly as spec §4.5: files = user `claudeDir/CLAUDE.md`; for `cwd` and each parent up to the root: `CLAUDE.md`, `.claude/CLAUDE.md` (scope project, nearest first); `cwd/CLAUDE.local.md` (local). Skills = `claudeDir/skills/*/SKILL.md` (user), `cwd/.claude/skills/*/SKILL.md` (project), each `installPath` in `claudeDir/plugins/installed_plugins.json` (`plugins: Record<"name@market", { installPath }[]>`) → `installPath/skills/*/SKILL.md` (plugin = part before `@`). Frontmatter: lines between leading `---` lines; `name:` / `description:` values with surrounding quotes stripped; missing name → folder name; description ≤ 200 chars. `used` when `used` contains `name` or `${plugin}:${name}`; sort skills used-first, then by name. Skip symlinks (`lstat`), unreadable files, bad JSON. Cap 300 skills. Read cap 64 × 1024 bytes; decode UTF-8.

- [ ] **Step 1: Failing tests** (`test/shelf.test.ts`, fixtures under `mkdtemp`: fake `claudeDir`, nested `root/a/b` as cwd):
  - `"lists user, project (incl. parents) and local files"` — scopes and order as above; `size` correct.
  - `"lists skills from user, project and plugins"` — plugin from `installed_plugins.json`; missing `name` → folder name; long description cut to 200.
  - `"marks used skills by name or plugin:name and sorts them first"`.
  - `"skips symlinked SKILL.md"` (skip the test when `symlink` throws EPERM on Windows).
  - `"reads an item and truncates at 64 KB"` — 70 000-byte CLAUDE.md → `truncated: true`, `text.length` ≤ 65 536.
  - `"unknown id → null"`.
  - `store.test.ts`: `"records skill names used by the session"` — two `Skill` tool events with the same skill + one employee event → unique list.
  - `http.test.ts`: shelf route 401 without token; 404 unknown session; 200 with fixture `claudeDir`; item route 404 for `..%2Fsecret.txt` and for a valid-format unknown id; 200 for a listed id.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; route regex `^\/api\/session\/([^/]+)\/shelf(?:\/([^/]+))?$` checked before the existing detail regex.
- [ ] **Step 4:** Tests + both tsc → PASS.
- [ ] **Step 5:** Commit `feat: bookshelf API for CLAUDE.md files and skills`.

---

### Task 5: Room model (pure)

**Files:**
- Create: `src/client/rooms.ts`, `test/rooms.test.ts`

**Interfaces:**
- Produces:
  - `ROOM_COLS = 16`, `ROOM_ROWS = 11`, `MAX_DESKS = 12`.
  - `interface Prop { tiles: number[]; w: number; x: number; y: number; name?: string; action?: Furniture }` (`tiles` laid out `w` wide from (x, y)).
  - `type Furniture = "safe" | "cabinet" | "phone" | "map" | "shelf"`.
  - `interface RoomTheme { floor: number; wall: number; props: Prop[] }`; `ROOM_THEMES: Partial<Record<District, RoomTheme>>`; `DEFAULT_THEME`; `OFFICE_THEME` (props: safe, cabinet, phone, map, bookshelf with `action` set and Vietnamese `name`s "Két token", "Tủ hồ sơ", "Điện thoại", "Bản đồ", "Kệ sách"; plus plant/whiteboard).
  - Theme props (on wall row y = 2, all districts): library bookshelf×2 + plant; design whiteboard + painting; site ladder + desk; database server×3; lab lab-bench×2 + plant; review painting×2 + bookshelf; factory machine×2; airport map + window×2; watchtower window×3; home bed + armchair + plant; townhall rug (y = 5) + candle×2. Floor/wall colours per district: reuse the city roof/wall colours from `city.ts` `PLOTS` (export a `districtColors(d)` helper or copy the 11 pairs).
  - `type Occupant = { kind: PickKind; id: string; name: string; badge: "" | "!" | "z"; done: boolean }`
  - `roomOccupants(d: District, sessions: Session[], employees: Employee[]): { people: Occupant[]; extra: number }` — mayors (`session.district === d`, sorted by `project` then `id`, name = project, badge from status), then working employees (`district === d`, sorted by `startedAt` then `id`, name = type); cap 12.
  - `deskSpots(n: number): Pt[]` — up to 12 seats on a 4×3 grid at x ∈ {2,5,10,13}, y ∈ {5,7,9} (row-major); the office uses the same spots for staff and `{ x: 7, y: 3 }` for the mayor's big desk.
  - `officeLayout(d: SessionDetail): { staff: Occupant[]; extra: number; board: string[] }` — working (by `startedAt`) then done (by `endedAt` desc), cap 12; `board = [title ?? project, STATUS_VI[status], prompt]` where `STATUS_VI = { working: "Đang làm", waiting: "Chờ bạn", idle: "Rảnh" }` and `prompt` = `lastPrompt` cut to 120 chars (119 + "…") or "—".
  - `tokenRows(d: SessionDetail): { rows: string[][]; total: string[]; staff: number } | null` — one row per `byModel` entry `[model, input, output, cacheRead, cacheWrite]` (numbers formatted `toLocaleString("vi-VN")`), total row, `staff` = sum of the 4 counters over `d.staff`; `null` when the session has no tokens.
  - `fileRows(d: SessionDetail): Employee[]` — `done` staff, newest `endedAt` first.
- [ ] **Step 1: Failing tests** covering each function: ordering, cap 12 + `extra`, done employees excluded from district rooms, 120-char cut and "—", `tokenRows` null on empty and staff sum, `fileRows` order, `deskSpots(12)` unique and inside the room and off the door column (x 7–8 at y = 10).
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement.  **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `feat: room model`.

---

### Task 6: Room drawing and furniture dialogs

**Files:**
- Create: `src/client/roomDraw.ts`, `src/client/shelfDialog.ts`
- Modify: `src/client/launcher.ts`
- Test: `test/launcher.test.ts`, `test/shelfDialog.test.ts`

**Interfaces:**
- Consumes: Task 1 constants, Task 5 model, `Shelf` types (Task 4).
- Produces:
  - `drawRoom(sheets: Sheets | null, theme: RoomTheme, seats: Seat[], board: string[], note: string | null, onFurniture: (f: Furniture) => void): Container` where `Seat = { at: Pt; big?: boolean; fig: Container | null; label: string; badge: string; done: boolean; onPick: () => void }`. Room is `ROOM_COLS × ROOM_ROWS` tiles: wall band rows 0–1 (wall colour), floor rows 2–10 (floor colour, subtle 2-tone checker), door gap at x 7–8 on row 10. Desk tile at the seat, chair below, figure standing on the chair; `done` seats show "✓ <label>" and no figure. Board text on the wall band (≤ 3 lines, 7 px font). `note` (e.g. "Chưa ai làm ở đây", "+3", "Không tải được, đang thử lại") centred near the door. Props with `action` get `cursor = "pointer"`, a hover name label and `pointertap → onFurniture(action)`. Without `sheets.indoor`: props as coloured rects, desks as brown rects.
  - `renderLaunchDialog(folders, onSubmit, preset?: string)` — `preset` is selected (added to `folders` when missing).
  - `renderTokenDialog(rows: ReturnType<typeof tokenRows>): HTMLElement` — title "Két token", table headers `Model | Input | Output | Cache đọc | Cache ghi`, total row "Tổng", line `Trong đó nhân viên: N token`; `null` → "Chưa dùng token nào".
  - `renderFilesDialog(list: Employee[], onPick: (id: string) => void): HTMLElement` — title "Hồ sơ", rows `type — description — HH:MM`; click → `onPick(id)` and dialog removed; empty → "Chưa có báo cáo nào".
  - `renderShelfDialog(load: () => Promise<Shelf>, read: (id: string) => Promise<{ text: string; truncated: boolean }>): HTMLElement` — sections "File nạp sẵn" / "Skill", scope labels `user → "của bạn"`, `project → "dự án"`, `local → "local"`, `plugin → "plugin <name>"`, used tag "đã dùng"; row click → `<pre>` + "← Kệ sách" button + "Đã cắt ở 64 KB" when truncated; empty → "Không thấy file hay skill nào"; load error → "Không tải được kệ sách".
  - Export the existing `el`/`frame` helpers from `launcher.ts` for reuse (no copy).
- [ ] **Step 1: Failing tests** (happy-dom): launch dialog preselects `preset` and adds it when missing; token dialog renders `<script>` model names as text, null → empty message; files dialog click calls `onPick` and removes itself; shelf dialog lists both sections with labels, opens content, back button returns, truncated note, load error message.
- [ ] **Step 2:** FAIL.  **Step 3:** Implement (drawing has no unit test; Task 8 checks it by eye).  **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `feat: room drawing and office furniture dialogs`.

---

### Task 7: Scene state

**Files:**
- Create: `src/client/scene.ts`, `test/scene.test.ts`
- Modify: `src/client/panel.ts` (Esc), `test/panel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Place = { kind: "city" } | { kind: "room"; district: District } | { kind: "office"; sessionId: string };
  export interface SceneDeps {
    mount: Container;                                   // room container parent
    draw(place: Exclude<Place, { kind: "city" }>, detail: SessionDetail | null, error: boolean): Container;
    fetchSession(id: string): Promise<SessionDetail | "gone">;
    onChange(place: Place): void;                        // main: toggle world/HUD/tooltip
  }
  export class Scene {
    place: Place;
    constructor(deps: SceneDeps);
    enter(p: Place): void;      // city → exit(); office → fetch then draw
    exit(): void;
    redraw(): void;             // re-draw current room/office with the last detail
    onDelta(d: Delta): void;    // office: removed id → exit; session or its employee changed → refetch, ≤ 1 per 1000 ms
  }
  ```
- Rules: one room container mounted at a time; the old one is `destroy({ children: true })`-ed. Each fetch carries a sequence number; stale results are dropped. `"gone"` → `exit()`. Network error → draw with `error = true` (or keep the last detail) and retry after 3000 ms while still in that office. Scene registers a `keydown` listener: Esc with `place.kind !== "city"` → `exit()`. `Panel`'s Esc handler changes to: only when the panel is open → `close()` and `e.stopImmediatePropagation()` (Panel is constructed before Scene, so its listener runs first).
- [ ] **Step 1: Failing tests** (happy-dom, fake timers, `Container` from pixi):
  - `"enter room draws once, exit destroys it"`; `"20 enter/exit cycles leave one or zero children"`.
  - `"office: stale fetch after exit is ignored"` and `"switching office ignores the first fetch"`.
  - `"office: gone → back to city"`; `"removed session in delta → back to city"`; `"delta for another session does not refetch"`; `"bursts of deltas refetch at most once per second"`; `"network error retries after 3 s"`.
  - `"Esc closes the panel first, then the room"` (real `Panel` on a happy-dom element, then `Scene`).
  - `panel.test.ts`: Esc on a closed panel does not stop propagation.
- [ ] **Step 2:** FAIL.  **Step 3:** Implement.  **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `feat: scene state for rooms and office`.

---

### Task 8: Wire it into the app

**Files:**
- Modify: `src/client/main.ts`, `src/client/hud.ts`, `src/client/index.html`, `src/client/actors.ts`

**Interfaces:**
- Consumes everything above.
- `Actors` constructor gains `onEnter: (p: Place) => void` (before `opts`). HQ house tap → `onEnter({ kind: "office", sessionId })` (was `onPick`). New hit containers over each `city.plots` rect (`zIndex = -1`, like HQ) → `onEnter({ kind: "room", district })`. New `portrait(kind: PickKind, id: string): Container | null` builds the same figure as the street actor (keeps last-synced employees in a map).
- HUD: `<button id="btn-back" type="button" hidden>← Về thành phố</button>` and `<span id="place-name" hidden>`; `hud.setPlace(name: string | null, onBack: () => void)`.
- `main.ts`: `roomLayer` container on the stage, laid out with the same scale rule for `ROOM_COLS*TILE × ROOM_ROWS*TILE`. `Scene.onChange`: city → `world.visible = true`, HUD place hidden; room/office → `world.visible = false`, `tip.hide()`, HUD shows district label or the session project. Hover handler returns early when not in the city. `draw` builds seats from `roomOccupants`/`officeLayout` + `actors.portrait`, board from `districtInfo` (room: label, sign, description, examples joined) or `officeLayout().board`, furniture → `safe` token dialog, `cabinet` files dialog (pick → `panel.open("employee", id)`), `phone` launch dialog with `preset = detail.cwd`, `map` → `scene.enter({ kind: "room", district: detail.district })`, `shelf` → shelf dialog using `/api/session/:id/shelf[/:itemId]`. `apply()` calls `scene.redraw()` when in a room; delta handler calls `scene.onDelta(d)`.
- [ ] **Step 1:** Implement; `npx vitest run` + both tsc + `npm run build` → all green.
- [ ] **Step 2: Manual check** (controller, built server + in-app browser): enter every district and two HQs; occupants match the street; click people → panel; each furniture item works (token table, files → employee panel, phone → dialog with folder preset, map → district room, bookshelf → lists and opens a file); Esc order; 20 enter/exit cycles keep `roomLayer.children.length ≤ 1`; cars take different turns; workers wander near doors; citizens walk; emulate reduced motion → still.
- [ ] **Step 3:** Commit `feat: enter buildings and office furniture`.
