# BackendCity Part 1 — City + Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that tails Claude Code transcripts and shows each session's mayor (and its subagent employees) walking between backend-phase districts of a pixel city in real time.

**Architecture:** Pure, tested core (`classify`, `parse`, `store`, `tail`, `path`) with no I/O assumptions; a thin Node layer (`watch`, `http`) that tails `~/.claude/projects/**.jsonl` and pushes batched deltas over a token-protected WebSocket; a Vite + PixiJS client that renders a tile city and animates sprites along A* paths on the road grid.

**Tech Stack:** Node ≥ 20, TypeScript (strict, ESM), `ws`, `pixi.js` v8, Vite, Vitest, `tsx` (dev only). No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-backendcity-design.md` (Part 1 = §1–§8, §10–§12)

## Global Constraints

- Read-only on `~/.claude/projects/`; Part 1 writes nothing outside the app folder.
- Server binds `127.0.0.1`, default port `4317`, `--port N` overrides.
- Random token per run (32 hex chars from `crypto.randomBytes(16)`), printed URL `http://127.0.0.1:<port>/?token=<t>`; every REST/WS request without the token → 401; WS also requires `Origin` = `http://127.0.0.1:<port>` (or `http://localhost:<port>`).
- No CDN / network fetches from the client; everything bundled.
- Session status: `working` = event within 60 s and last turn not ended; `waiting` = last event is `turnEnd`; `idle` = no event for 10 min; sessions with no event for 24 h are hidden.
- Strings (prompt, tool input, report) truncated to 4096 chars in the store, suffix `…`.
- Initial load: only files modified in the last 24 h; read at most the last 2 MB of each, starting at the first full line.
- Deltas batched every 250 ms.
- Classification rules live in `config/districts.json`; first matching rule wins; no match → `null` (keep current district).
- Test fixtures are hand-written; never commit real transcripts.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Two sessions running in the same project folder at once → two separate HQs/mayors (keyed by `sessionId`, not folder). Test in Task 4.
- A single transcript line of several MB (big tool result) → tail returns it whole, store keeps ≤ 4096 chars. Tests in Task 2 and Task 4.
- A new session file created while the server runs → appears within one 2 s scan. Test in Task 5.
- Subagent `meta.json`/transcript seen before the parent's `Agent` tool_use is parsed → employee still linked to its prompt once the spawn arrives. Test in Task 4.
- Project folder with Vietnamese/unicode characters → name shown from the record's `cwd`, not the encoded directory name. Test in Task 3.

---

## File Structure

```
package.json · tsconfig.json · tsconfig.server.json · vite.config.ts · vitest.config.ts · .gitignore
config/districts.json
src/shared/types.ts        District, Session, Employee, Tokens, Event, State, Delta
src/shared/districts.ts    DISTRICTS (ordered list + Vietnamese labels)
src/server/classify.ts     loadRules, classify
src/server/tail.ts         Tailer, tailStart
src/server/parse.ts        parseLine, parseMeta
src/server/store.ts        Store
src/server/watch.ts        Watcher
src/server/http.ts         startServer
src/server/main.ts         CLI entry
src/client/index.html · main.ts · net.ts · city.ts · path.ts · actors.ts · hud.ts
test/*.test.ts             one file per server module + path
```

---

### Task 1: Scaffold, shared types, classifier

**Files:** Create everything under "File Structure" that is config/scaffolding, plus `src/shared/types.ts`, `src/shared/districts.ts`, `config/districts.json`, `src/server/classify.ts`, `test/classify.test.ts`.

**Interfaces:**
- Produces (`src/shared/types.ts`), exactly as spec §6.1 plus:
  - `type Event = … | { kind: "agentMeta"; sessionId: string; agentId: string; toolUseId: string; type: string; description: string; at: string }`
  - `interface State { sessions: Session[]; employees: Employee[] }`
  - `interface Delta { sessions: Session[]; employees: Employee[]; removed: string[] }` (changed items only; `removed` = ids of hidden sessions/employees)
  - `Employee.id` = agentId (`agent-<id>` file stem without `agent-`)
- Produces (`src/server/classify.ts`):
  - `interface Rule { district: District; tool?: string; command?: string; path?: string }` — each field a case-insensitive regex; `command` tests `input.command`, `path` tests `input.file_path ?? input.notebook_path ?? input.path`
  - `loadRules(json: unknown): Rule[]` — throws `Error("districts.json: rule N …")` on unknown district or invalid regex
  - `classify(rules: Rule[], tool: string, input: unknown): District | null`

- [ ] **Step 1:** `npm init -y`; set `"type": "module"`, scripts `test: vitest run`, `dev:server: tsx watch src/server/main.ts`, `dev:client: vite`, `build: tsc -p tsconfig.server.json && vite build`, `start: node dist/server/main.js`. Install `ws pixi.js`; dev `typescript vite vitest tsx @types/node @types/ws`. Vite root `src/client`, outDir `../../dist/client`. `.gitignore`: `node_modules/ dist/`.
- [ ] **Step 2:** Write `config/districts.json` with the spec §7 table as ordered rules. Order matters: `design` path rules (`docs/`, `\.md$`) and `database` path rules (`[\\/]Migrations[\\/]`, `\.sql$`) **before** the generic `site` edit rule; Bash rules: database → lab → factory → airport → review → watchtower (so `git push` hits airport before review's `git`).
- [ ] **Step 3: Failing tests `test/classify.test.ts`** (rules = `loadRules(JSON.parse(read config/districts.json))`)

```ts
it.each([
  ["Read", { file_path: "src/a.cs" }, "library"],
  ["Grep", { pattern: "x" }, "library"],
  ["TodoWrite", {}, "design"],
  ["Write", { file_path: "docs/superpowers/specs/x.md" }, "design"],
  ["Edit", { file_path: "src/Api/Program.cs" }, "site"],
  ["Edit", { file_path: "src/Infra/Migrations/2026_Init.cs" }, "database"],
  ["Bash", { command: "dotnet ef database update" }, "database"],
  ["Bash", { command: "dotnet test --no-build" }, "lab"],
  ["Bash", { command: "npm run test" }, "lab"],
  ["Bash", { command: "dotnet build -c Release" }, "factory"],
  ["Bash", { command: "git push origin main" }, "airport"],
  ["Bash", { command: "git commit -m x" }, "review"],
  ["Bash", { command: "gh pr view 3" }, "review"],
  ["Bash", { command: "docker logs api" }, "watchtower"],
])("%s %j → %s", (tool, input, d) => expect(classify(rules, tool, input)).toBe(d));
it("unmatched bash keeps district", () => expect(classify(rules, "Bash", { command: "ls -la" })).toBeNull());
it("unknown tool keeps district", () => expect(classify(rules, "Agent", { prompt: "x" })).toBeNull());
it("rejects unknown district", () => expect(() => loadRules([{ district: "moon", tool: "Read" }])).toThrow(/rule 1/));
it("rejects bad regex", () => expect(() => loadRules([{ district: "lab", command: "(" }])).toThrow(/rule 1/));
```

- [ ] **Step 4:** `npm test` → FAIL (module missing). Implement `classify.ts`. `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: scaffold BackendCity and district classifier`.

---

### Task 2: Tailer

**Files:** `src/server/tail.ts`, `test/tail.test.ts`

**Interfaces:**
- `tailStart(size: number, maxBytes = 2 * 1024 * 1024): number` — `max(0, size - maxBytes)`
- `class Tailer { constructor(path: string, offset?: number); read(): Promise<string[]>; get offset(): number }` — reads from `offset` to EOF, returns complete lines (CRLF/LF stripped, empty lines dropped); keeps the trailing partial line in a buffer; if constructed with offset > 0, discards text up to and including the first `\n` (partial first line); if file size < offset → reset to 0 and clear buffer; missing file → `[]`.

- [ ] **Step 1: Failing tests** (temp dir via `fs.mkdtemp`)

```ts
it("returns complete lines and holds the partial one", ...)   // write "a\nb" → ["a"]; append "c\n" → ["bc"]
it("handles CRLF", ...)                                         // "x\r\ny\r\n" → ["x","y"]
it("skips the cut first line when starting mid-file", ...)      // file "aaa\nbbb\n", new Tailer(p, 2) → ["bbb"]
it("restarts after truncation", ...)                            // read all, overwrite with "z\n" → ["z"]
it("returns a multi-MB single line whole", ...)                 // 3 MB "x".repeat + "\n" → one line of length 3*1024*1024
it("missing file gives no lines", ...)
it("tailStart clamps", () => { expect(tailStart(100)).toBe(0); expect(tailStart(5e6)).toBe(5e6 - 2 * 1024 * 1024); })
```

- [ ] **Step 2:** FAIL → implement with `fs.promises.open` + `read` into a Buffer sized `size - offset`; decode UTF-8 only at line boundaries (keep partial bytes as Buffer, not string, so a split multi-byte char survives). → PASS.
- [ ] **Step 3:** Commit `feat: incremental transcript tailer`.

---

### Task 3: Parser

**Files:** `src/server/parse.ts`, `test/parse.test.ts`, `test/fixtures/*.jsonl` (hand-written)

**Interfaces:**
- Consumes: `Rule`, `classify`, `Event`.
- `interface LineContext { sessionId: string; agentId?: string }`
- `parseLine(line: string, ctx: LineContext, rules: Rule[]): Event[]` — never throws; invalid JSON / unknown `type` → `[]`.
  - `user` with string content or text blocks (and not a tool_result, not `isMeta`) and no `ctx.agentId` → `prompt`.
  - `user` with `tool_result` whose `tool_use_id` matches nothing known here → `report` (store decides relevance).
  - `assistant`: each `tool_use` → `tool` (district via `classify`); `name` `Agent` or `Task` → additionally `spawn{toolUseId: id, type: input.subagent_type ?? "general-purpose", description, prompt}`; `message.usage` → `usage{model: message.model}`; `stop_reason` `end_turn` with no tool_use → `turnEnd`.
  - any record with `cwd` / `gitBranch`, and `custom-title` → `meta` (title from `customTitle`/`title`).
  - `at` = record `timestamp`.
- `parseMeta(json: string, ctx: {sessionId: string; agentId: string; at: string}): Event | null` → `agentMeta` from `{agentType, description, toolUseId}`; null if invalid.

- [ ] **Step 1: Failing tests** (one fixture line per case)

```ts
it("user text → prompt")
it("assistant Read tool_use → tool in library")
it("assistant Agent tool_use → tool + spawn with prompt/description/type")
it("legacy Task name also spawns")
it("usage → usage event with model and 4 token fields")
it("end_turn without tools → turnEnd")
it("tool_result → report with tool_use_id and text (string or text blocks joined)")
it("cwd with unicode → meta.cwd kept verbatim", () => /* cwd "D:\\Học\\Dự án" */)
it("broken JSON → []"); it("unknown type → []"); it("extra unknown fields ignored")
it("parseMeta reads agentType/description/toolUseId; bad JSON → null")
```

- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit `feat: parse transcript lines into city events`.

---

### Task 4: Store

**Files:** `src/server/store.ts`, `test/store.test.ts`

**Interfaces:**
- Consumes: `Event`, `Session`, `Employee`, `State`, `Delta`.
- `class Store { constructor(now: () => number = Date.now); apply(e: Event): void; tick(): void; snapshot(): State; drainDelta(): Delta | null }`
  - Sessions keyed by `sessionId`; created on first event; `project` = basename of `cwd` (fallback `sessionId.slice(0,8)`).
  - `tool` without agentId → session district (if not null) + `working`; with agentId → that employee's district.
  - `spawn` → remember `{toolUseId → prompt, description, type}`; `agentMeta` → employee keyed by agentId with `toolUseId`; whichever comes second fills the other's fields (order-independent). A new employee starts with `district` = its session's current district and `status: "working"`; the client spawns its sprite at the session's HQ door and walks it there.
  - `report` whose `tool_use_id` matches an employee's `toolUseId` → that employee `done`, `endedAt`.
  - `turnEnd` without agentId → session `waiting`, district `townhall`.
  - `usage` → add to session (and employee if agentId) `tokens` + `byModel[model]`; set `session.model` from main-agent usage.
  - `tick()`: no event 10 min → `idle` + `home`; no event 24 h → hidden (id into `removed`); `done` employees removed 30 s after `endedAt`.
  - All stored strings ≤ 4096 chars + `…`.
  - `drainDelta()` returns changed sessions/employees since last drain, or `null` if nothing changed.

- [ ] **Step 1: Failing tests** (fake clock)

```ts
it("tool moves mayor to the classified district and marks working")
it("null district keeps the current district")
it("turnEnd → waiting at townhall")
it("idle after 10 minutes → home; hidden after 24 h → in removed")
it("two sessions in the same cwd are two sessions")
it("spawn then agentMeta links prompt to employee")
it("agentMeta then spawn links too")
it("report marks the matching employee done; removed 30 s later")
it("usage sums per session, per employee and per model")
it("5 MB prompt stored as 4096 chars + …")
it("drainDelta returns only changes, then null")
```

- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit `feat: city state store`.

---

### Task 5: Watcher, HTTP/WebSocket server, CLI

**Files:** `src/server/watch.ts`, `src/server/http.ts`, `src/server/main.ts`, `test/watch.test.ts`, `test/http.test.ts`

**Interfaces:**
- Consumes: `Tailer`, `tailStart`, `parseLine`, `parseMeta`, `loadRules`, `Store`.
- `class Watcher { constructor(root: string, onEvents: (events: Event[]) => void, opts?: { intervalMs?: number; maxAgeMs?: number }); start(): Promise<void>; stop(): void }`
  - Scan `root/*/*.jsonl` (session = file stem) and `root/*/<sessionId>/subagents/agent-*.jsonl` (+ sibling `.meta.json`, parsed once) every `intervalMs` (default 2000); files with `mtime` older than `maxAgeMs` (default 24 h) skipped; new files start at `tailStart(size)`; each tick reads every tailer, maps lines with `parseLine(line, {sessionId, agentId}, rules)`, emits in one batch. Read errors → skip this tick. Root missing → no events, keep scanning.
- `startServer(opts: { port: number; token: string; store: Store; clientDir: string }): Promise<{ url: string; close(): Promise<void> }>`
  - `GET /` and static assets from `clientDir` require `?token=` on `/` only (assets are public bundle files); `GET /api/state?token=` → `store.snapshot()`; `/ws?token=` upgrade checks token + Origin; on connect send `{type:"state", state}`; every 250 ms `drainDelta()` → broadcast `{type:"delta", delta}`; `store.tick()` every 1 s.
  - Wrong/missing token → 401; bad Origin → 403.
- `main.ts`: parse `--port`, build store + watcher(`~/.claude/projects`) + server, print URL, `SIGINT` → close.

- [ ] **Step 1: Failing tests**

```ts
// watch.test.ts (temp root, intervalMs 50)
it("picks up a session file created after start within one scan")
it("emits events for appended lines")
it("links subagent transcript lines to agentId and reads meta.json")
it("ignores files older than maxAgeMs")
// http.test.ts (port 0)
it("GET /api/state without token → 401")
it("GET /api/state with token → JSON state")
it("WS with wrong Origin → rejected (403)")
it("WS with token+origin receives state then delta after a store change")
```

- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Run `npm run dev:server` against the real `~/.claude/projects` → prints URL; `curl` `/api/state?token=…` lists current sessions (count only, don't paste contents anywhere).
- [ ] **Step 4:** Commit `feat: watch transcripts and serve city state over WebSocket`.

---

### Task 6: Client city

**Files:** `src/client/index.html`, `main.ts`, `net.ts`, `city.ts`, `path.ts`, `actors.ts`, `hud.ts`, `test/path.test.ts`

**Interfaces:**
- `path.ts`: `type Pt = { x: number; y: number }`; `findPath(walkable: boolean[][], from: Pt, to: Pt): Pt[]` — 4-neighbour A*, Manhattan heuristic, returns path excluding `from` and including `to`, `[]` if unreachable or `from == to`.
- `city.ts`: `buildCity(): { cols: number; rows: number; walkable: boolean[][]; doors: Record<District, Pt>; hqDoors: Pt[]; draw(): Container }` — fixed 48×32 tile grid (16 px tiles, scale 2), ring road + cross streets, 11 district plots each with a labelled building and a door tile on the road, a row of HQ plots (≥ 12 `hqDoors`).
- `actors.ts`: `class Actors { constructor(city, layer: Container); sync(state: State): void; update(dtMs: number): void }` — one mayor sprite per session at `hqDoors[i]` (i = stable index by first-seen order), one employee sprite per employee spawned at its session's HQ door; when district changes, compute `findPath` to `doors[district]` and walk at 6 tiles/s; status badge: `waiting` = "!" bubble, `idle` = "z"; label = project name (mayor) / `type` (employee).
- `net.ts`: `connect(onState: (s: State) => void, onDelta: (d: Delta) => void)` — reads token from `location.search`, WS `/ws?token=`, reconnect backoff 1 s → 2 s → 4 s … max 10 s, refetch state on reconnect.
- `hud.ts`: top bar with counts (working / waiting / idle) and a connection dot.
- Art: Part 1 draws pixel art procedurally with PixiJS `Graphics` (tiles, buildings, characters as 8×12 pixel figures with per-session colour). Ruling (spec said Kenney CC0 assets): downloading asset packs needs the user's go-ahead; procedural art keeps Part 1 self-contained; swapping in a CC0 pack is a later task with `ASSETS.md`.

- [ ] **Step 1: Failing `test/path.test.ts`**

```ts
it("straight corridor"); it("goes around a wall"); it("unreachable → []"); it("same point → []")
```

- [ ] **Step 2:** FAIL → implement `path.ts` → PASS.
- [ ] **Step 3:** Implement city, actors, net, hud, main. `npm run build` → 0 errors.
- [ ] **Step 4:** Run `npm run dev:server` + `npm run dev:client` (Vite proxy `/api` and `/ws` to 4317). Open the printed URL in the built-in browser: city renders, current sessions' mayors at HQ/townhall, no console errors.
- [ ] **Step 5:** Commit `feat: pixel city client`.

---

### Task 7: End-to-end check

- [ ] `npm run build && npm start` → open URL. In a separate terminal the **user** runs a Claude Code session doing Read → Edit → test command → `git commit`, and asks it to use a subagent. Expected: mayor walks Library → Construction site → Lab → Review; an employee appears at the HQ, walks to its district, returns/disappears after its report; `waiting` shows "!" at the Town hall.
- [ ] Record what could not be checked. `git status` clean.
