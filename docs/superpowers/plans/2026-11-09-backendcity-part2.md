# BackendCity Part 2 — HQ, Employees, City Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a mayor/HQ or an employee to see what it was asked, what it did and what it reported; redraw the city with Kenney CC0 tiles and characters; give every building a sign and a hover card.

**Architecture:** Server keeps a 100-step ring buffer per actor plus report/models/lastPrompt and serves two token-protected detail routes; the WebSocket delta stays light. The client adds DOM overlays (panel, tooltip) built by pure render functions tested with happy-dom, and swaps procedural art for sprite-sheet textures with a procedural fallback.

**Tech Stack:** unchanged (Node ≥ 20, TS strict ESM, ws, pixi.js v8, Vite, Vitest) + dev dependency `happy-dom`.

**Spec:** `docs/superpowers/specs/2026-11-09-backendcity-part2-design.md` (Part 1 spec `2026-11-09-backendcity-design.md` still binds).

## Global Constraints

- All Part 1 constraints still hold (127.0.0.1, token on `/api/*` and `/ws`, Origin check, no network fetches from the client, hand-written fixtures, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Map grid stays 48×32 with the same road rows/cols, plot doors and `hqDoors` — `walkable` and existing path/city tests must not change.
- Tool step `summary` ≤ 200 chars; ring buffer = 100 newest steps per mayor and per employee; prompt/report ≤ 4096 chars + `…`.
- Detail routes: `GET /api/session/:id`, `GET /api/employee/:id`, same token rule, unknown id → 404 `{"error":"not found"}`. Delta does not carry steps/report.
- Transcript-derived text is inserted with `textContent` only — never `innerHTML`.
- Sprite sheets: `assets/kenney/roguelike-modern-city/tilemap_packed.png` (16×16, no spacing, 37×28) and `assets/kenney/roguelike-characters/roguelikeChar_transparent.png` (16×16, 1 px spacing), imported through Vite. If loading fails → Part 1 procedural art.
- Tile indices live only in `src/client/tiles.ts` as named constants.
- Decorative traffic is disabled under `prefers-reduced-motion: reduce`.

## Review Focus

- Transcript text containing `<script>`/HTML (prompt, report, summary, project name) → rendered as literal text. Test in Task 6.
- A multi-KB single-line Bash command or path → summary cut to 200 chars; panel wraps instead of overflowing. Test in Task 1 (cut) and Task 6 (CSS `overflow-wrap:anywhere` asserted on the step element).
- Ids needing URL encoding → client uses `encodeURIComponent`, server decodes; encoded id resolves. Test in Task 3.
- Panel open on an employee that is then removed → detail 404 → panel shows "Phiên/nhân viên này đã kết thúc" and keeps the last data. Test in Task 6.
- Sprite sheet fails to load → `loadSheets()` resolves `null`, city draws procedurally. Test in Task 4.

---

## File Structure

```
src/shared/types.ts        + ToolStep, SessionDetail, EmployeeDetail; prompt Event gains text
src/shared/districts.ts    DistrictInfo {id,label,sign,description,examples}
src/server/summary.ts      summarize (new)
src/server/parse.ts        prompt event carries text
src/server/store.ts        steps ring buffers, report, models, lastPrompt, detailSession/detailEmployee
src/server/http.ts         two detail routes
src/client/tiles.ts        loadSheets + named tile constants (new)
src/client/city.ts         tile-based drawing, signs, plot rects for hover, procedural fallback
src/client/actors.ts       layered character sprites, facing flip, click → onPick
src/client/traffic.ts      decorative cars (new)
src/client/panel.ts        renderSession/renderEmployee + Panel controller (new)
src/client/tooltip.ts      renderDistrictCard + hover wiring (new)
src/client/main.ts         wiring; index.html styles for panel/tooltip
test/summary.test.ts · test/districts.test.ts · test/store.test.ts · test/http.test.ts · test/tiles.test.ts · test/panel.test.ts · test/tooltip.test.ts
```

---

### Task 1: Summaries and district info

**Files:** Create `src/server/summary.ts`, `test/summary.test.ts`, `test/districts.test.ts`; Modify `src/shared/districts.ts`.

**Interfaces:**
- Produces: `summarize(name: string, input: unknown): string` (≤ 200 chars; longer → first 199 + `…`).
- Produces: `interface DistrictInfo { id: District; label: string; sign: string; description: string; examples: string[] }`; `DISTRICTS: DistrictInfo[]` (same order/labels as today); `districtInfo(id: District): DistrictInfo`.
- Content: spec §5.3 table verbatim (sign, description, examples) for all 11 districts.

- [ ] **Step 1: Failing tests**

```ts
// summary.test.ts
it.each([
  ["Bash", { command: "dotnet test" }, "dotnet test"],
  ["Read", { file_path: "src/a.cs" }, "src/a.cs"],
  ["NotebookEdit", { notebook_path: "n.ipynb" }, "n.ipynb"],
  ["Grep", { pattern: "Foo", path: "src" }, "Foo in src"],
  ["Grep", { pattern: "Foo" }, "Foo"],
  ["Glob", { pattern: "**/*.ts" }, "**/*.ts"],
  ["WebFetch", { url: "https://x" }, "https://x"],
  ["WebSearch", { query: "q" }, "q"],
  ["Agent", { subagent_type: "Explore", description: "find api" }, "Explore: find api"],
  ["Task", { description: "d" }, "general-purpose: d"],
  ["Mystery", { a: 1 }, "Mystery"],
])("%s → %s", (n, i, s) => expect(summarize(n, i)).toBe(s));
it("cuts to 200 with …", () => { const s = summarize("Bash", { command: "x".repeat(5000) }); expect(s.length).toBe(200); expect(s.endsWith("…")).toBe(true); });
it("null/odd input falls back to tool name", () => { expect(summarize("Bash", null)).toBe("Bash"); expect(summarize("Read", { file_path: 3 })).toBe("Read"); });
// districts.test.ts
it("every district has sign, description, examples", ...)  // 11 entries, ids unique, sign/description non-empty, examples array
it("Phòng thí nghiệm sign is 'Chạy test'", () => expect(districtInfo("lab").sign).toBe("Chạy test"));
```

- [ ] **Step 2:** `npm test` → FAIL. Implement. → PASS; existing tests still pass (labels unchanged).
- [ ] **Step 3:** Commit `feat: tool step summaries and district notes`.

---

### Task 2: Store detail data

**Files:** Modify `src/shared/types.ts`, `src/server/parse.ts`, `src/server/store.ts`, `test/parse.test.ts`, `test/store.test.ts`.

**Interfaces:**
- Consumes: `summarize`.
- Produces (types): `interface ToolStep { at: string; name: string; summary: string; district: District | null }`; `interface SessionDetail extends Session { lastPrompt?: string; steps: ToolStep[]; staff: Employee[] }`; `interface EmployeeDetail extends Employee { report?: string; models: string[]; steps: ToolStep[] }`. (`staff`, not `employees`: `Session.employees` is already `string[]`.)
- Produces: prompt Event gains `text: string` (user text joined, as parse already extracts it).
- Produces (Store): `detailSession(id: string): SessionDetail | undefined`; `detailEmployee(id: string): EmployeeDetail | undefined`. Steps newest first, ≤ 100; mayor steps = tool events without agentId; employee steps = its own; `staff` = the session's employees including done ones still present; `lastPrompt` = latest prompt text (cut 4096); `report` = text of the matching `report` event (cut 4096), absent until one arrives; `models` = distinct models from that employee's usage in first-seen order. Snapshot/Delta shapes unchanged.

- [ ] **Step 1: Failing tests**

```ts
// parse: user text line → prompt event with text "hello"
// store:
it("keeps the 100 newest mayor steps, newest first")    // 150 tool events → length 100, steps[0] is #150
it("employee steps are separate from mayor steps")
it("step summary and district come from summarize/classify")
it("report text attaches to the matching employee")
it("lastPrompt is the latest prompt text, cut to 4096 + …")
it("models are distinct in first-seen order")
it("detailSession includes done staff still present")
it("unknown ids → undefined")
it("snapshot/delta do not contain steps or report")    // JSON of snapshot has no "steps"/"report"
```

- [ ] **Step 2:** FAIL → implement → PASS; full suite; both tsc configs clean.
- [ ] **Step 3:** Commit `feat: per-actor tool history and detail views in the store`.

---

### Task 3: Detail routes

**Files:** Modify `src/server/http.ts`, `test/http.test.ts`.

**Interfaces:** Consumes `Store.detailSession/detailEmployee`. Produces `GET /api/session/:id` → `SessionDetail`, `GET /api/employee/:id` → `EmployeeDetail` (JSON, `Cache-Control: no-store`). `:id` = one path segment, `decodeURIComponent`d (malformed encoding → 400).

- [ ] **Step 1: Failing tests:** both routes 401 without token; 404 `{"error":"not found"}` for unknown id; correct body for known id; id containing `:` sent as `%3A` resolves; `/api/session/%E0%A4%A` → 400; `/api/session/a/b` → 404.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit `feat: session and employee detail routes`.

---

### Task 4: Sprite sheets and tile-based city

**Files:** Create `src/client/tiles.ts`, `test/tiles.test.ts`; Modify `src/client/city.ts`, `src/client/main.ts`; add `happy-dom` dev dependency (also used by Task 6).

**Interfaces:**
- `interface Sheets { city(index: number): Texture; char(col: number, row: number): Texture }`
- `loadSheets(load: (url: string) => Promise<Texture> = Assets.load): Promise<Sheets | null>` — `null` if either sheet fails. `city(i)` = frame `(i % 37, ⌊i/37⌋)` of the packed sheet; `char(c, r)` = frame at `(c*17, r*17)`.
- Named constants (implementer picks indices by viewing the sheets; one constant per visual role): roads (horizontal, vertical, centre dash, crossing/crosswalk), sidewalk, grass variants, tree, bush, streetlight, bench, parked cars, and per-district facade/roof pieces.
- `buildCity(sheets: Sheets | null)` returns the Part 1 shape plus `plots: { id: District; px: { x: number; y: number; w: number; h: number } }[]` and `hqPlots: { x; y; w; h }[]` (pixel rects for hover/click). Doors, `walkable`, `hqDoors` identical to Part 1. With `sheets === null` the current procedural drawing is used unchanged.
- Each district plot draws a building distinct per spec §5.1 table, its label, and a sign plaque with `districtInfo(id).sign` under the label.
- `main.ts`: `const sheets = await loadSheets()` before `buildCity(sheets)`.

- [ ] **Step 1: Failing `test/tiles.test.ts`:** `loadSheets` with a loader that rejects → `null`; with a fake loader returning a texture-like object of 592×448 → `city(38)` frame is `{x:16,y:16,w:16,h:16}` and `char(2,1)` frame is `{x:34,y:17,w:16,h:16}`. Existing `test/path.test.ts` and any city tests stay green.
- [ ] **Step 2:** FAIL → implement → PASS; `npm run build` 0 errors.
- [ ] **Step 3:** Commit `feat: draw the city with Kenney tiles and district signs`.

---

### Task 5: Characters, picking, traffic

**Files:** Modify `src/client/actors.ts`, `src/client/main.ts`; Create `src/client/traffic.ts`.

**Interfaces:**
- `new Actors(city, layer, bake, sheets: Sheets | null, onPick: (kind: "session" | "employee", id: string) => void)`.
- Mayor sprite = layered char textures (body + suit + hat/tie) with shirt colour chosen per session from the sheet's colour variants; employee outfit by type per spec §5.2 table (`Explore`, `Plan`, `general-purpose`, contains `review`, contains `test`, other). `sheets === null` → Part 1 figures.
- Facing: `scale.x = -1` when walking left; bob unchanged; badges "!", "z", "+N" unchanged. Fix the Part 1 deferred minor: set badge style only when it changes.
- Pointer: mayors, employees and HQ plots (`city.hqPlots[slot]`) are `eventMode = "static"`, `cursor = "pointer"`; click → `onPick`.
- `class Traffic { constructor(city, layer: Container, sheets: Sheets | null); update(dtMs: number): void }` — 4 cars looping on the ring road at 3 tiles/s; no cars when `sheets === null` or `matchMedia("(prefers-reduced-motion: reduce)").matches`.

- [ ] **Step 1:** Implement; `npm run build` 0 errors; full suite green.
- [ ] **Step 2:** Commit `feat: Kenney characters, facing, click to pick, ambient traffic`.

---

### Task 6: Panel and tooltip

**Files:** Create `src/client/panel.ts`, `src/client/tooltip.ts`, `test/panel.test.ts`, `test/tooltip.test.ts`; Modify `src/client/main.ts`, `src/client/index.html` (styles + containers).

**Interfaces:**
- `renderSession(d: SessionDetail, now: number, onPickEmployee: (id: string) => void): HTMLElement` — spec §4 sections in order: header (project, branch, model, status badge, "x phút trước"), "Yêu cầu gần nhất" (collapsible `<details>`), token table, "Nhân viên" list (working first), "Hoạt động gần đây" (20 newest steps).
- `renderEmployee(d: EmployeeDetail, now: number, onBack: () => void): HTMLElement` — header, "Thị trưởng giao việc" (`<pre>`), "Các bước đã làm" (≤100), "Báo cáo lại" (report or "Đang làm…"); prompt/report ending with `…` get the note "(đã rút gọn — xem đầy đủ trong transcript)".
- `class Panel { constructor(root: HTMLElement, fetchDetail: (kind, id) => Promise<SessionDetail | EmployeeDetail | "gone">); open(kind, id): Promise<void>; close(): void; onDelta(d: Delta): void }` — refetch at most once per second when the delta mentions the open id; `"gone"` (404) → banner "Phiên/nhân viên này đã kết thúc", keep last content; network error → keep content silently; `Esc` and ✕ close.
- `renderDistrictCard(info: DistrictInfo, present: string[]): HTMLElement` — label, sign, description, "Agent tới đây khi:" examples list, "Đang có mặt:" up to 6 names + "…".
- Tooltip follows the pointer over `city.plots`; hidden elsewhere. Panel width 360 px, full screen under 600 px. Step rows use `overflow-wrap: anywhere`.
- `main.ts`: `onPick` → `panel.open`; deltas → `panel.onDelta`; fetch uses `encodeURIComponent(id)` and the page token.

- [ ] **Step 1: Failing tests** (`// @vitest-environment happy-dom`)

```ts
it("prompt with <script> renders as text", ...)      // el.querySelector("script") === null && textContent includes "<script>"
it("project name with <img onerror> renders as text")
it("truncated prompt shows the rút gọn note")
it("employee without report shows Đang làm…")
it("session lists working staff before done")
it("step row has overflow-wrap:anywhere")
it("Panel shows ended banner on gone and keeps content")
it("Panel refetches once per second at most on matching deltas") // fake timers, 3 deltas in 200 ms → 1 fetch
it("district card lists examples and caps present names at 6")
```

- [ ] **Step 2:** FAIL → implement → PASS; build 0 errors; full suite; both tsc clean.
- [ ] **Step 3:** Commit `feat: HQ and employee panels, building hover cards`.

---

### Task 7: End-to-end check

- [ ] Controller: `npm run build && npm start`, open in the in-app browser: Kenney map, 11 recognisable districts with signs, hover card content, click a mayor and an employee → panels with correct sections, live update while a session runs, no console errors.
- [ ] Record what could not be checked. `git status` clean.
