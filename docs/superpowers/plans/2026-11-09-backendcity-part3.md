# BackendCity Part 3 — Launch Sessions + Subagent Model Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a new Claude Code session in Windows Terminal from the city (folder, model, default subagent model, prompt), and toggle an app-managed `Explore` agent that runs on Haiku.

**Architecture:** Pure, tested server modules — `launch.ts` (validate + build argv, never a shell) and `agents.ts` (manage only marker-tagged `Explore.md`) — behind three token + Origin + JSON-guarded routes with injected side effects so tests never spawn processes or touch `~/.claude`. Client adds two DOM dialogs built with `textContent`.

**Tech Stack:** unchanged (Node ≥ 20, TS strict ESM, ws, pixi.js, Vite, Vitest + happy-dom). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-backendcity-part3-design.md` (Part 1/2 specs still bind).

## Global Constraints

- Model aliases allowed: `opus`, `sonnet`, `haiku`, `fable` (session model); subagent model: `haiku`, `sonnet`, `opus`.
- `POST /api/launch`, `GET /api/agents/explore`, `PUT /api/agents/explore`: token (as all `/api/*`), and for POST/PUT also `Origin` ∈ {`http://127.0.0.1:<port>`, `http://localhost:<port>`} and `Content-Type: application/json`. Status codes: 401 token, 403 origin, 415 content-type, 413 body > 16 KB, 400 invalid input, 409 claude missing / user-owned Explore.md, 500 spawn/write failure, 202 launch ok.
- Error bodies `{"error": "<Vietnamese message>"}`.
- `cwd`: absolute, exists, is a directory, not UNC (`\\` prefix). `prompt` ≤ 4000 chars, no control chars except `\n` `\t`.
- Launch never uses a shell to join a command string; `spawn(file, args, { detached: true, stdio: "ignore", shell: false })` + `unref()`.
- `wt.exe` present → `wt.exe -w new new-tab -d <cwd> --title BackendCity <claude> [--model m] [--settings <file>] [-- <prompt>]`; every `;` in any argument passed through wt → `\;`. Absent → `cmd.exe /c start "BackendCity" /D <cwd> <claude> …`.
- `subagentModel` → temp file `%TEMP%\backendcity-<random hex>.json` = `{"env":{"CLAUDE_CODE_SUBAGENT_MODEL":"<alias>"}}`, passed via `--settings`, deleted after 60 s.
- Agents dir = `~/.claude/agents/`. App only writes/deletes `Explore.md` containing the line `<!-- managed-by: BackendCity -->`; never touches other files; writes via temp name + rename.
- Tests never spawn real processes and never read/write the real `~/.claude`.
- Client text via `textContent` only.
- Commit trailer `Co-Authored-By: <model that wrote it> <noreply@anthropic.com>`.

## Review Focus

- Prompt containing `;`, quotes, newlines, a leading `-` → arrives as one literal argument (wt-escaped `;`, after `--`). Test in Task 1.
- `cwd` with spaces/Vietnamese characters → passed as a single argv element. Test in Task 1.
- Cross-site request: a page on another origin POSTing `text/plain` to `/api/launch` → 403/415, nothing spawned. Test in Task 3.
- `claude` missing (found null at startup) → launch 409 with install hint; city keeps working. Test in Task 3.
- User already has a hand-written `Explore.md` → state `user`, PUT 409, file byte-identical afterwards. Test in Task 2.

---

## File Structure

```
src/server/launch.ts      ALIASES, SUB_ALIASES, LaunchOpts, validateLaunch, buildLaunch, settingsJson, findOnPath, launch
src/server/agents.ts      MARKER, exploreState, setExplore, UserOwnedError
src/server/http.ts        body reader (16 KB cap) + 3 routes; new startServer options
src/server/main.ts        resolve claude/wt paths, agents dir, real launcher
src/client/launcher.ts    renderLaunchDialog, renderModelRules, wiring helpers
src/client/hud.ts, main.ts, index.html   two HUD buttons + dialog styles
test/launch.test.ts · test/agents.test.ts · test/http.test.ts · test/launcher.test.ts
```

---

### Task 1: Launch validation and argv builder

**Files:** Create `src/server/launch.ts`, `test/launch.test.ts`.

**Interfaces:**
- `type Alias = "opus" | "sonnet" | "haiku" | "fable"`; `type SubAlias = "haiku" | "sonnet" | "opus"`; `ALIASES`, `SUB_ALIASES` arrays.
- `interface LaunchOpts { cwd: string; model?: Alias; subagentModel?: SubAlias; prompt?: string }`
- `validateLaunch(body: unknown, isDir: (p: string) => boolean): { ok: true; opts: LaunchOpts } | { ok: false; error: string }` — empty-string model/subagentModel/prompt treated as absent.
- `settingsJson(sub: SubAlias): string` → `{"env":{"CLAUDE_CODE_SUBAGENT_MODEL":"<sub>"}}`.
- `buildLaunch(opts: LaunchOpts, env: { claude: string; wt: string | null; settingsFile?: string }): { file: string; args: string[] }`.
- `findOnPath(name: string, extra: string[]): string | null` — checks `PATH` dirs (Windows `PATHEXT`) then `extra` candidates; uses `fs.existsSync` only.
- `launch(opts: LaunchOpts, deps: { claude: string; wt: string | null; spawn: typeof import("node:child_process").spawn; tmpDir: string; setTimeout: typeof setTimeout }): Promise<void>` — writes settings file when needed, spawns per constraints, schedules deletion, rejects if spawn emits `error` synchronously-ish (listen once, resolve on `spawn` event).

- [ ] **Step 1: Failing tests**

```ts
// validate
it("rejects relative cwd"); it("rejects missing dir (isDir false)"); it("rejects UNC \\\\server\\share");
it("rejects unknown model 'gpt'"); it("rejects subagentModel 'fable'");
it("rejects prompt > 4000 chars"); it("rejects prompt with \\u0007"); it("accepts \\n and \\t in prompt");
it("treats empty strings as absent");
// build with wt
const env = { claude: "C:\\u\\.local\\bin\\claude.exe", wt: "C:\\wt.exe" };
it("wt argv order", () => expect(buildLaunch({ cwd: "D:\\Học\\Dự án x", model: "opus", prompt: "a; b" }, env)).toEqual({
  file: "C:\\wt.exe",
  args: ["-w", "new", "new-tab", "-d", "D:\\Học\\Dự án x", "--title", "BackendCity", env.claude, "--model", "opus", "--", "a\\; b"],
}));
it("prompt starting with '-' stays after --");
it("no model → no --model; no prompt → no --");
it("settingsFile → --settings <file> before --");
it("semicolon in cwd escaped too");
// build without wt
it("cmd start fallback", () => expect(buildLaunch({ cwd: "D:\\p" }, { claude: "C:\\c.exe", wt: null })).toEqual({
  file: "cmd.exe", args: ["/c", "start", "BackendCity", "/D", "D:\\p", "C:\\c.exe"],
}));
it("settingsJson", () => expect(JSON.parse(settingsJson("haiku"))).toEqual({ env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } }));
// launch with fake spawn + temp dir
it("spawns detached, shell false, unref called");
it("writes settings file with subagentModel and deletes it after 60 s (fake setTimeout)");
it("spawn error → launch rejects");
```

- [ ] **Step 2:** `npm test` → FAIL. Implement → PASS; both tsc clean.
- [ ] **Step 3:** Commit `feat: validate and build Claude launch commands`.

---

### Task 2: Explore agent manager

**Files:** Create `src/server/agents.ts`, `test/agents.test.ts`.

**Interfaces:**
- `MARKER = "<!-- managed-by: BackendCity -->"`.
- `exploreState(dir: string): "off" | "on" | "user"` — no `Explore.md` → off; contains MARKER → on; else user.
- `class UserOwnedError extends Error {}`.
- `setExplore(dir: string, enabled: boolean): "off" | "on"` — user-owned file → throws `UserOwnedError` (no write); enabled → create dir if missing, write `Explore.md.tmp-<hex>` then rename to `Explore.md`; disabled → delete only if MARKER present. File content: frontmatter `name: Explore`, `description: Fast read-only agent for exploring codebases: finding files, searching code and answering questions about the code. Use for read-only investigation.`, `tools: Read, Grep, Glob`, `model: haiku`; then MARKER line; then a short read-only exploration prompt (implementer writes 3–6 sentences: search broadly, read relevant files, report file paths and findings, never modify files).

- [ ] **Step 1: Failing tests** (temp dir per test)

```ts
it("off when no file"); it("on → file has frontmatter model: haiku, name: Explore and MARKER");
it("on then off deletes it"); it("off when already off is a no-op");
it("user-owned file → state user; setExplore(true/false) throws UserOwnedError; file bytes unchanged");
it("other files in dir untouched (csharp-reviewer.md content identical)");
it("creates the agents dir when missing");
it("no .tmp- files left after on");
```

- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit `feat: manage an app-owned Explore agent on Haiku`.

---

### Task 3: Routes and server wiring

**Files:** Modify `src/server/http.ts`, `src/server/main.ts`, `test/http.test.ts`.

**Interfaces:**
- `startServer` options gain `claude: string | null`, `agentsDir: string`, `launcher: (opts: LaunchOpts) => Promise<void>`.
- Body reader: collect ≤ 16 384 bytes, else 413 (stop reading); invalid JSON → 400.
- Routes per Global Constraints; order: method → token → (POST/PUT) Origin → content-type (`application/json`, params allowed) → body → validate → act. `GET /api/agents/explore` → `{ state }`. `PUT` body `{ enabled: boolean }` → `{ state }`; `UserOwnedError` → 409 `{"error":"Bạn đã có Explore.md riêng — BackendCity không sửa file này"}`. Launch: `claude === null` → 409 `{"error":"Chưa cài Claude Code CLI — chạy: winget install Anthropic.ClaudeCode"}`; launcher reject → 500 `{"error":"Không mở được terminal"}`; ok → 202 `{"ok":true}`. Existing routes unchanged.
- `main.ts`: `claude = findOnPath("claude", [join(homedir(), ".local", "bin", "claude.exe")])`, `wt = findOnPath("wt", [])`, `agentsDir = join(homedir(), ".claude", "agents")`, `launcher = opts => launch(opts, { claude, wt, spawn, tmpDir: tmpdir(), setTimeout })`; print one extra line when claude is missing.

- [ ] **Step 1: Failing tests** (own Store + server per describe; fake launcher records calls; agentsDir = temp dir)

```ts
it("launch without token → 401"); it("launch wrong Origin → 403"); it("launch text/plain → 415, launcher not called");
it("launch body 20 KB → 413"); it("launch bad JSON → 400"); it("launch relative cwd → 400");
it("launch valid → 202 and launcher got opts"); it("claude null → 409");
it("launcher rejects → 500, server still answers /api/state");
it("GET explore → off"); it("PUT explore {enabled:true} → on and file exists in temp dir");
it("PUT explore on user-owned file → 409"); it("PUT explore text/plain → 415");
```

- [ ] **Step 2:** FAIL → implement → PASS; full suite; both tsc; build.
- [ ] **Step 3:** Commit `feat: launch and model-rule routes`.

---

### Task 4: Client dialogs

**Files:** Create `src/client/launcher.ts`, `test/launcher.test.ts`; Modify `src/client/hud.ts`, `src/client/main.ts`, `src/client/index.html`.

**Interfaces:**
- `renderLaunchDialog(folders: string[], onSubmit: (opts: { cwd: string; model?: string; subagentModel?: string; prompt?: string }) => Promise<string | null>): HTMLElement` — folder `<select>` (distinct cwds from State, sorted) + free path `<input>` (input wins when non-empty), model select (Mặc định/Opus/Sonnet/Haiku/Fable → ""/opus/…), subagent select (Không đặt/Haiku/Sonnet/Opus), prompt `<textarea maxlength=4000>`, "Mở" button; `onSubmit` resolves an error message or `null` (success → "Đã mở terminal", dialog closes after 1.5 s).
- `renderModelRules(state: "off" | "on" | "user", onToggle: (enabled: boolean) => Promise<"off" | "on" | string>): HTMLElement` — checkbox "Explore dùng Haiku"; `user` → disabled + explanation; note "Áp dụng cho phiên mở sau khi bật".
- HUD gets buttons "+ Mở phiên" and "Quy tắc model". `main.ts` posts JSON with `Content-Type: application/json` to `/api/launch?token=…` and `/api/agents/explore?token=…`, maps error bodies to messages.
- Esc / ✕ close dialogs; one dialog at a time.

- [ ] **Step 1: Failing tests** (`// @vitest-environment happy-dom`)

```ts
it("folder names with <b> render as text");
it("typed path wins over select"); it("empty selects omit model/subagentModel");
it("shows server error text"); it("success message then closes");
it("rules: user state disables checkbox and explains");
it("rules: toggle calls onToggle(true) and shows new state");
```

- [ ] **Step 2:** FAIL → implement → PASS; build; full suite; both tsc.
- [ ] **Step 3:** Commit `feat: launch and model-rule dialogs`.

---

### Task 5: End-to-end check

- [ ] Controller restarts the server on the new build, opens the dialogs in the in-app browser, checks rendering and errors (e.g. relative path → message). Opening a real terminal session is done **by the user** (it opens a window on their desktop); controller confirms the new HQ appears.
- [ ] Explore toggle: on → `~/.claude/agents/Explore.md` created with marker; off → removed; `csharp-reviewer.md` / `database-reviewer.md` untouched (compare hashes before/after). Only with the user's go-ahead, since it writes to `~/.claude`.
- [ ] `git status` clean.
