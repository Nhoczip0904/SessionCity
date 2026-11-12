# Embedded Session Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button in a mayor's panel opens a real terminal inside the BackendCity page running `claude --resume <id>`.

**Architecture:** On the server, `PtyHub` (`src/server/pty.ts`) runs claude through node-pty, and a new `/pty` WebSocket upgrade on the existing HTTP server streams terminal output to the browser and keystrokes back. On the client, `src/client/term.ts` draws the overlay with xterm.js. The panel button opens it, after a confirmation step when the session is busy.

**Tech Stack:** Node 24 ESM + TypeScript, `ws`, `node-pty` 1.1.0, `@xterm/xterm`, `@xterm/addon-fit`, Vite, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-12-backendcity-terminal-design.md`

## Global Constraints

- The server only listens on 127.0.0.1. `/pty` uses the same token check (`tokenOk`) and Origin check as `/ws`.
- Session id regex: `^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`, case-insensitive. The id must also belong to a session the store is tracking.
- claude is spawned with the argument array `["--resume", id]`, no shell, `name: "xterm-256color"`, `env: process.env`.
- At most 3 terminals at once. `maxPayload` is 65536 bytes.
- `cols`: default 120, clamped to 20–400. `rows`: default 32, clamped to 5–200.
- When claude exits, close the WebSocket with code `4000` and reason = the exit code as a string.
- Never call `kill()` on a terminal that has already exited (node-pty throws `AttachConsole failed`).
- UI copy (Vietnamese, exact):
  - button: "Mở phiên trong terminal"; while a terminal is open: "Terminal đang mở"
  - title: "Terminal — <project>"
  - exit line: "Phiên đã kết thúc (mã X)"
  - connection error: "Không kết nối được terminal"
  - confirm text: "Phiên này có thể đang mở ở chỗ khác (app desktop hoặc terminal). Mở thêm sẽ có hai nơi cùng ghi vào một cuộc trò chuyện."
  - confirm buttons: "Vẫn mở" / "Huỷ"
- Each change ends with `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.server.json --noEmit`, `npx vitest run` and `npm run build` all passing. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never read real `~/.claude` transcripts in tests.

## Review Focus

1. Pasting a large block (100 000 characters) must not blow the 64 KB limit and drop the connection. The client splits input into messages of at most 16 384 characters. Test in Task 4.
2. Vietnamese and other non-ASCII input ("Xin chào ✓") reaches claude byte for byte. Test in Task 2.
3. A session whose folder has been deleted opens in `homedir()`. Test in Task 2.
4. A window resize before the socket has opened sends nothing and does not throw. Test in Task 4.
5. Server shutdown with open terminals kills them (`killAll`). Test in Task 2.

---

### Task 1: PtyHub and dependencies

**Files:**
- Modify: `package.json` (via `npm i node-pty@1.1.0 @xterm/xterm @xterm/addon-fit`)
- Create: `src/server/pty.ts`
- Test: `test/pty.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PtyProc { onData(cb: (d: string) => void): unknown; onExit(cb: (e: { exitCode: number }) => void): unknown; write(d: string): void; resize(cols: number, rows: number): void; kill(): void }
  export type PtySpawn = (file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) => PtyProc;
  export interface Term { onData(cb: (d: string) => void): void; onExit(cb: (code: number) => void): void; write(d: string): void; resize(cols: number, rows: number): void; kill(): void }
  export class PtyHub { constructor(spawn: PtySpawn, claude: string | null, max?: number /* 3 */); open(sessionId: string, cwd: string, cols: number, rows: number): Term | null; killAll(): void; readonly size: number }
  ```

- [ ] **Step 1: Install deps.** Run `npm i node-pty@1.1.0 @xterm/xterm @xterm/addon-fit`. npm blocks node-pty's install script; this is expected, because `prebuilds/win32-x64` ships inside the package. Check: `node -e "require('node-pty')"` exits 0.
- [ ] **Step 2: Write failing tests** in `test/pty.test.ts` using a fake spawn that records calls and returns a controllable proc:
  - `open` spawns the claude path with `["--resume", id]` and `{ name: "xterm-256color", cols, rows, cwd, env: process.env }`.
  - `open` returns `null` when `claude` is null, and returns `null` once there are 3 open (`size === 3`).
  - When a proc exits, `size` drops and the slot is free again. `Term.onExit` receives the exit code.
  - `kill()` after the proc exited does not call `proc.kill`. `kill()` while running calls it once.
  - `killAll()` kills every running proc and leaves `size === 0`.
- [ ] **Step 3: Run** `npx vitest run test/pty.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement `PtyHub`** in `src/server/pty.ts`. Keep a `Set` of live entries; each entry has an `exited` flag.
- [ ] **Step 5: Run** the tests again. Expected: PASS. Run the full checks from Global Constraints.
- [ ] **Step 6: Commit** `feat: PtyHub runs claude --resume in a pseudo-terminal`

### Task 2: `/pty` WebSocket channel

**Files:**
- Modify: `src/server/http.ts` (the upgrade handler at about line 230 and `close()` at about line 270; add the `pty` option to `startServer`)
- Modify: `src/server/main.ts` (create `new PtyHub(nodePty.spawn, claude)` and pass it in)
- Test: `test/http-pty.test.ts`

**Interfaces:**
- Consumes: `Term`, and `PtyHub` from Task 1.
- Produces: the `startServer` option `pty?: { open(sessionId: string, cwd: string, cols: number, rows: number): Term | null; killAll(): void }`, and `export const clampSize = (v: string | null, def: number, min: number, max: number): number` in `http.ts`.

- [ ] **Step 1: Write failing tests** in `test/http-pty.test.ts`.
  - Setup: a real `startServer` on port 0, with a store holding one session (meta event with `cwd` set to a temp dir), and a fake `pty` that records `open` arguments and returns a controllable `Term`. Connect with `ws` using `Origin: http://127.0.0.1:<port>`.
  - Rejections:
    - no token → 401
    - `Origin: http://evil.example` → 403
    - unknown UUID → 404
    - `session=--help` → 404
    - fake `open` returns null → 503
    - none of these call `open`
  - Opening: `cols=5&rows=999` → `open` receives 20 and 200; missing values → 120 and 32.
  - A session whose `cwd` folder was deleted → `open` receives `os.homedir()`.
  - Input: `{"t":"in","d":"Xin chào ✓"}` → `Term.write("Xin chào ✓")`.
  - Resize: `{"t":"size","cols":1000,"rows":1}` → `resize(400, 5)`.
  - Garbage is ignored and the socket stays open: `"nope"`, `{"t":"in","d":5}`, `{"t":"x"}`.
  - Output: `Term` emits `"hi"` → the client receives the text `"hi"`.
  - Client closes → `Term.kill` is called.
  - `Term` emits exit 7 → the client sees close code 4000 with reason `"7"`.
  - `srv.close()` calls `pty.killAll`.
- [ ] **Step 2: Run** `npx vitest run test/http-pty.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add a second `new WebSocketServer({ noServer: true, maxPayload: 65536 })`.
  - In the upgrade handler, route `/pty` and do the checks in the order of the spec table, rejecting via the existing `reject(status, text)`.
  - Hoist the UUID regex into `const SESSION_ID` at module level in `http.ts` and use it here (Task 3 deletes `resumeRoute`). Get the `cwd` with `isDir(s.cwd) ? s.cwd : homedir()`.
  - Bridge data both ways. On socket close, kill the terminal. On `onExit`, call `ws.close(4000, String(code))`.
  - `close()` calls `opts.pty?.killAll()`.
  - In `main.ts`: `import * as nodePty from "node-pty"`. Also call `hub.killAll()` on SIGINT before exit.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: /pty websocket bridges a browser terminal to claude --resume`

### Task 3: Remove the external-terminal resume path

**Files:**
- Modify: `src/server/http.ts` (delete `resumeRoute`, the `desk` regex, and its entry in `allowed`)
- Modify: `src/server/launch.ts` (drop `LaunchOpts.resume` and the `resume` job field)
- Modify: `bin/claude-launch.mjs` (drop `SESSION_ID` and the `resume` branch)
- Delete: `test/http-resume.test.ts`
- Modify: `test/claude-launch.test.ts` (drop the two resume tests)

- [ ] **Step 1:** Make the deletions listed above. `POST /api/session/<id>/resume` now returns 405, because the path falls back to the GET-only list. Add that assertion to `test/http-pty.test.ts`.
- [ ] **Step 2: Run** the full checks. Expected: PASS. Also check that `grep -rn "resume" src bin` shows only the `/pty` spawn arguments.
- [ ] **Step 3: Commit** `refactor: drop the external-terminal resume route`

### Task 4: Terminal overlay

**Files:**
- Create: `src/client/term.ts`
- Modify: `src/client/index.html` (overlay styles: `.term-overlay` fixed full screen with a dim background; `.term-box` 80vw × 80vh, centered, dark; title bar; ✕ button)
- Test: `test/term.test.ts` (happy-dom)

**Interfaces:**
- Produces:
  ```ts
  export interface TermDeps { makeTerm(): { open(el: HTMLElement): void; onData(cb: (d: string) => void): unknown; write(s: string): void; focus(): void; dispose(): void; cols: number; rows: number; fit(): void }; WebSocket: typeof WebSocket }
  export function openTerminal(opts: { sessionId: string; title: string; token: string; onClose: () => void }, deps?: TermDeps): void;
  export const isTerminalOpen: () => boolean;
  ```
  The default `deps` wrap `new Terminal()` with `FitAddon` loaded (where `fit()` calls `fitAddon.fit()`) and the global `WebSocket`. Import `@xterm/xterm/css/xterm.css` in `term.ts`.

- [ ] **Step 1: Write failing tests** with a fake `makeTerm` and a fake `WebSocket` class that records the URL and sent frames and can fire `onopen`, `onmessage` and `onclose`.
  - The URL is `ws://<location.host>/pty?token=…&session=…&cols=<term.cols>&rows=<term.rows>`, taken after `fit()`.
  - The overlay shows "Terminal — proj", and `isTerminalOpen()` is true.
  - `onData("ab")` sends `{"t":"in","d":"ab"}`.
  - `onData` with 100 000 characters sends several frames, each with `d.length <= 16384`, and their `d` values join back to the original.
  - A window `resize` before open sends nothing and does not throw. After open, it sends `{"t":"size",…}`.
  - A `keydown` Escape inside the overlay does not reach a `document` keydown listener.
  - Clicking ✕ closes the socket, disposes the terminal, removes the overlay, calls `onClose`, and makes `isTerminalOpen()` false.
  - A message `"out"` → `term.write("out")`.
  - Close code 4000 with reason `"3"` → writes a line containing "Phiên đã kết thúc (mã 3)", and the overlay stays.
  - Any other close before or after open → writes "Không kết nối được terminal".
- [ ] **Step 2: Run** `npx vitest run test/term.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `openTerminal`.** Stop `keydown` propagation on the overlay root. Remove the window `resize` listener on close.
- [ ] **Step 4: Run** the tests and the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: xterm overlay for a session terminal`

### Task 5: Panel button, confirmation and wiring

**Files:**
- Modify: `src/client/panel.ts` (replace the `openDesktop` callback and `desktop()` with a terminal hook)
- Modify: `src/client/launcher.ts` (add `confirmDialog`)
- Modify: `src/client/main.ts` (wiring; delete the `/resume` POST call)
- Test: `test/panel.test.ts` (rewrite the two Desktop/terminal button tests)

**Interfaces:**
- Consumes: `openTerminal` and `isTerminalOpen` from Task 4. `showDialog(d: HTMLElement)` already exists in `launcher.ts`.
- Produces:
  - `export function confirmDialog(text: string, ok: string, cancel: string): Promise<boolean>` in `launcher.ts`.
  - The third parameter of the `Panel` constructor: `terminal?: { isOpen(): boolean; open(d: SessionDetail): void; confirm(text: string): Promise<boolean> }`.
  - `renderSession(d, now, onPickEmployee, onTerminal?: () => void, termOpen?: boolean)`.

- [ ] **Step 1: Write failing tests** in `test/panel.test.ts`, replacing the two existing Desktop-button tests and using a fake `terminal`.
  - A `waiting` session: clicking `button.desktop` calls `confirm` with the exact confirm text. If it resolves `false`, `open` is not called; if `true`, `open` is called with the detail.
  - An `idle` session: clicking calls `open` straight away, without `confirm`.
  - With `isOpen()` true, the button is disabled and reads "Terminal đang mở".
  - There is no button for an employee, or when no `terminal` is given.
- [ ] **Step 2: Run** `npx vitest run test/panel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Panel: the button text is "Mở phiên trong terminal". When the session `status !== "idle"`, call `confirm` first. Drop the `note` element and `desktop()`.
  - `confirmDialog`: `showDialog` with the text and two buttons ("Vẫn mở" resolves true; "Huỷ" or closing resolves false).
  - `main.ts`: `new Panel(panelRoot, fetchDetail, { isOpen: isTerminalOpen, open: (d) => openTerminal({ sessionId: d.id, title: d.project, token, onClose: () => void panel.open("session", d.id) }), confirm: (t) => confirmDialog(t, "Vẫn mở", "Huỷ") })`. Re-opening the panel in `onClose` redraws it, so the button unlocks.
- [ ] **Step 4: Run** the full checks. Expected: PASS.
- [ ] **Step 5: Manual check in the browser.** Restart the server (`node dist/server/main.js`). Open an idle session's panel, then "Mở phiên trong terminal":
  - the overlay shows Claude Code's UI;
  - type `/help` and the help appears;
  - Esc does not close the overlay;
  - ✕ closes it, and the `claude.exe` started for it is gone (`tasklist`);
  - opening again shows the previous conversation.
- [ ] **Step 6: Commit** `feat: open a session's terminal inside BackendCity from its panel`
