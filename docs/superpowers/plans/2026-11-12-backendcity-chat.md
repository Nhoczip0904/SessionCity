# BackendCity Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude-Desktop-style chat overlay that continues a session through `claude -p` in stream-json mode, with tool cards and Allow/Deny permission prompts, next to the existing embedded terminal.

**Architecture:**
- Server: `ChatHub` (src/server/chat.ts) spawns claude through `child_process`. A `/chat` WebSocket in http.ts relays its JSON lines and sends recent history read from the transcript (src/server/history.ts).
- Client: `openChat` (src/client/chat.ts) renders bubbles, tools and permission cards from those events. The panel gets two buttons.

**Tech Stack:** Node 24, TypeScript strict ESM (`.js` import suffix), `ws`, `child_process`, Vite, `marked` (new, client only), Vitest + happy-dom.

**Spec:** docs/superpowers/specs/2026-11-12-backendcity-chat-design.md

## Global Constraints

- **Spawn args (exact):** `["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--resume", sessionId, "--permission-prompts", "host"]`, plus only the extra flags Task 1's probe proves necessary.
- **Spawn options:** `{ cwd, env: process.env, stdio: "pipe", windowsHide: true }`. No shell and no string-built commands.
- **Limits:**
  - at most 3 chats;
  - WebSocket `maxPayload` 262144;
  - `say` text non-empty and ≤ 100000 chars;
  - history ≤ 50 items, each text ≤ 20000 chars, read only from the last 4 MB of the file;
  - tool result shown ≤ 5000 chars.
- **`/chat` rejections, before upgrade and in this order:**
  - 401 token;
  - 403 Origin;
  - 404 for a non-UUID id or an untracked session;
  - 503 when the hub is full or there is no claude;
  - 500 when spawn throws, and the server must not crash.
- **Close codes:** claude exit closes the WebSocket with 4000 and reason = exit code. A failed handshake kills the chat (the `up` flag, as in `/pty`).
- **Exact UI copy:**
  - "Chat", "Terminal", "Đang mở chat", "Terminal đang mở";
  - "Chat — <project>", "— tin cũ —";
  - "Cho phép", "Từ chối", "Đã cho phép", "Đã từ chối";
  - "Gửi", "Dừng", "Sao chép";
  - "Phiên đã kết thúc (mã X)", "Không kết nối được chat".
- **Deny message sent to claude:** "Người dùng từ chối".
- **One overlay per page across chat and terminal.** While either is open, both panel buttons are disabled.
- **No raw HTML from claude or tools in the DOM.** Markdown `html` tokens are escaped, and links are kept only for `http:`/`https:`, with `target="_blank" rel="noopener"`.
- **Privacy:** never read, list or open anything under `C:\Users\nguye\.claude` in tests, probes or reports. Use temp dirs and fake transcripts.

## Review Focus

1. **A stdout chunk split mid-line or mid-UTF-8 character.** Events must still parse exactly once. Task 2 test: "joins split lines and multibyte chars".
2. **A permission answer arriving after claude exited, or for an id never asked.** Nothing is written and nothing crashes. Task 2 test "answer after exit is a no-op", and Task 4 test "ignores unknown request ids".
3. **A history file that is huge, has a partial first line, or contains non-JSON lines.** History still returns the last items. Task 3 test: "survives a partial first line and junk".
4. **Markdown with `<img onerror>`, `<script>` or a `javascript:` link.** It renders inert. Task 5 test: "escapes html and drops unsafe links".
5. **The user scrolled up while text streams.** The view must not jump to the bottom. Task 5 test: "keeps scroll position when the user scrolled up".

---

### Task 1: Probe the stream-json control protocol (throwaway)

**Files:**
- Create: `C:\Users\nguye\AppData\Local\Temp\claude\…\scratchpad\chatprobe\probe.mjs`. This is outside the repo and never committed.
- Modify: this plan's **Protocol** section below (fill in the observed shapes), then commit the plan.

- [ ] **Step 1:** Write `probe.mjs`. It spawns the resolved `claude.exe` with the Global args, minus `--resume <id>`, inside a fresh empty temp dir as `cwd`. It then writes one user line to stdin asking claude to run the shell command `echo hi`, and logs every stdout line verbatim to `probe.log`.
- [ ] **Step 2:** When a line with `"type":"control_request"` and `subtype` `can_use_tool` arrives, write a `control_response` allowing it, and log whether the tool then runs. In a second run, deny instead, and log claude's reaction. In a third run, send an interrupt `control_request` mid-answer, and log the result.
- [ ] **Step 3:** If no `can_use_tool` request ever arrives, retry with `--permission-prompt-tool stdio` added. Record which variant works. If neither works, STOP and report BLOCKED: the spec needs the user's decision.
- [ ] **Step 4:** Record in the Protocol section below, verbatim:
  - the exact user input line;
  - the `control_request` line (can_use_tool);
  - the accepted allow, deny and interrupt lines;
  - the `stream_event` text-delta shape;
  - the `assistant`, `user` (tool_result) and `result` line shapes;
  - the final extra flags, if any.
- [ ] **Step 5:** Commit: `docs: chat plan — record observed stream-json protocol`.

**Protocol (filled by Task 1):**
- input user line: _to fill_
- can_use_tool request: _to fill_
- allow response / deny response / interrupt request: _to fill_
- text delta / assistant / tool_result / result shapes: _to fill_
- extra spawn flags: _to fill (none expected)_

---

### Task 2: ChatHub

**Files:**
- Create: `src/server/chat.ts`
- Test: `test/chat.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ChatProc { stdout: NodeJS.ReadableStream; stdin: NodeJS.WritableStream; on(ev: "exit", cb: (code: number | null) => void): unknown; on(ev: "error", cb: (e: Error) => void): unknown; kill(): unknown }
export type ChatSpawn = (file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: "pipe"; windowsHide: true }) => ChatProc;
export interface Chat { onEvent(cb: (e: Record<string, unknown>) => void): void; onExit(cb: (code: number) => void): void; say(text: string): void; answer(requestId: string, allow: boolean): void; interrupt(): void; kill(): void; pending(requestId: string): boolean }
export class ChatHub { constructor(spawn: ChatSpawn, claude: string | null, max?: number /* 3 */); open(sessionId: string, cwd: string): Chat | null; killAll(): void; readonly size: number }
```
- `pending(id)` is true while a `can_use_tool` request with that id is unanswered. `answer` removes it. `answer` must reuse the tool's original `input` as `updatedInput` when allowing; keep that input from the request.

- [ ] **Step 1: Write failing tests** in `test/chat.test.ts`. Use a fake spawn built on `PassThrough` streams and an `EventEmitter`.
  - "spawns claude with the exact args": the args equal the Global args with `"abc"` as the id; the opts are `{cwd:"/proj", env: process.env, stdio:"pipe", windowsHide:true}`.
  - "returns null when full or without claude": 3 opens succeed, the 4th returns null; `new ChatHub(spawn, null).open(...)` returns null.
  - "exit frees the slot; kill frees it at once and kills once": two `kill()` calls → `proc.kill` called once and `size` 0.
  - "joins split lines and multibyte chars": write `'{"type":"a","t":"xin ch'`, then `'ào"}\n{"type":"b"}\n'` as Buffers, splitting the UTF-8 bytes of "à" across the chunks. Expect events `[{type:"a",t:"xin chào"},{type:"b"}]`. A non-JSON line is skipped.
  - "say / answer / interrupt write the protocol lines": parse each stdin line and compare it to the Task 1 Protocol shapes. Allow carries the request's original input as `updatedInput`. Deny carries the message "Người dùng từ chối".
  - "pending tracks unanswered can_use_tool ids": `pending` is true after a can_use_tool event and false after `answer`.
  - "answer after exit is a no-op": after exit, `say`/`answer`/`interrupt` neither throw nor write.
- [ ] **Step 2:** Run `npx vitest run test/chat.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/server/chat.ts` following `PtyHub`'s shape (src/server/pty.ts):
  - an `exited` flag guards every write and kill;
  - `kill` deletes from `live` at once;
  - decode stdout with `StringDecoder("utf8")` and split on `\n`;
  - swallow `error` events on the proc and on stdin.
- [ ] **Step 4:** Run the test. Expected: PASS. Then run both tsc configs.
- [ ] **Step 5:** Commit `feat: ChatHub runs claude in stream-json mode`.

---

### Task 3: History from the transcript

**Files:**
- Create: `src/server/history.ts`
- Modify: `src/server/watch.ts` (add `fileOf`)
- Test: `test/chat-history.test.ts`

**Interfaces:**
- Produces:
```ts
export type HistoryItem = { role: "user" | "claude"; text: string } | { role: "tool"; name: string; summary: string };
export async function history(file: string, n?: number /* 50 */): Promise<HistoryItem[]>; // oldest → newest
// Watcher:
fileOf(sessionId: string): string | undefined; // the main transcript (tracked entry with that sessionId and no agentId)
```
- Consumes: `summarize(name, input)` from src/server/summary.ts.

- [ ] **Step 1: Write failing tests**, using a temp-dir `.jsonl` built from records shaped like the ones src/server/parse.ts reads.
  - "maps user, assistant text and tool_use": a user string → `{role:"user"}`; assistant text blocks → `{role:"claude"}`; `tool_use` `Bash {command:"ls"}` → `{role:"tool", name:"Bash", summary: summarize("Bash",{command:"ls"})}`.
  - "skips tool_result-only users, isMeta and command tags": user content containing `<command-name>`, `<local-command-stdout>` or `<system-reminder>`, user `isMeta: true`, and tool_result-only users all produce no item.
  - "keeps the last 50 and cuts long text": 120 turns → length 50, the last item is the newest, and a 30000-char text comes back with length 20000.
  - "survives a partial first line and junk": the file starts mid-line and has a `garbage` line → no throw, valid items returned.
  - "reads only the tail of a big file": a file > 4 MB with a marker turn at the start and recent turns at the end → the marker is absent.
  - "missing file → []".
  - Watcher: "fileOf returns the main transcript". Follow existing watch tests: a temp root with `<proj>/<sid>.jsonl` and `<proj>/<sid>/subagents/agent-x.jsonl` → `fileOf(sid)` returns the first path. An unknown id returns undefined.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - read the last 4 MB with `fs.open` + `read` at offset `max(0, size-4MB)`, and drop the first partial line when offset > 0;
  - JSON.parse each line in try/catch;
  - `fileOf` scans `tracked`.
- [ ] **Step 4:** Run the tests and tsc. Expected: PASS.
- [ ] **Step 5:** Commit `feat: chat history from the session transcript`.

---

### Task 4: `/chat` WebSocket

**Files:**
- Modify: `src/server/http.ts`, `src/server/main.ts`
- Test: `test/http-chat.test.ts`

**Interfaces:**
- Consumes: `Chat`, `ChatHub` (Task 2); `history`, `HistoryItem`, `Watcher.fileOf` (Task 3).
- Produces:
  - the `startServer` option `chat?: { open(sessionId: string, cwd: string): Chat | null; killAll(): void; history(sessionId: string): Promise<HistoryItem[]> }`;
  - server→client frames `{t:"history", items}` (always first) and `{t:"ev", e}`;
  - client→server frames `{t:"say",text}`, `{t:"allow"|"deny",id}`, `{t:"stop"}`.
- main.ts wiring:
  - `new ChatHub(child_process.spawn, claude)`;
  - `history: async (sid) => { const f = watcher.fileOf(sid); return f ? history(f) : [] }`;
  - `killAll` on shutdown, next to the pty hub.

- [ ] **Step 1: Write failing tests**, modelled on `test/http-pty.test.ts`: a real server and a fake chat hub recording calls.
  - "rejects 401/403/404/503 and 500 when open throws, and stays up".
  - "sends history first, then relays events": the first frame is `{t:"history", items:[…]}`; after the fake chat emits `{type:"x"}`, the client gets `{t:"ev", e:{type:"x"}}`.
  - "routes say/allow/deny/stop": `say "hi"` → `say("hi")`; empty text or 100001 chars → ignored; `allow` with a pending id → `answer(id,true)`; `deny` → `answer(id,false)`.
  - "ignores unknown request ids": `pending` false → no `answer` call.
  - "bad JSON ignored, socket stays open".
  - "close kills; exit closes with 4000 and reason": closing the socket calls kill; exit code 3 closes with code 4000 and reason "3".
  - "uppercase session id accepted".
  - "kills the chat when the handshake is invalid", copying the `/pty` test.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `/chat` beside `/pty` in the shared `upgrade` handler, reusing its token, Origin and SESSION_ID checks and the cwd fallback:
  - a separate `WebSocketServer({noServer:true, maxPayload:262144})`;
  - send history before relaying events: await `history(sid)`, then subscribe. Buffer events that arrive during the await;
  - wrap every chat call in try/catch.
  - Add `/chat` to `vite.config.ts` proxy (`ws: true, rewriteWsOrigin: true`).
- [ ] **Step 4:** Run the full suite, both tsc configs and `npm run build`. Expected: clean.
- [ ] **Step 5:** Commit `feat: /chat websocket bridges the chat panel to claude`.

---

### Task 5: Chat overlay

**Files:**
- Create: `src/client/chat.ts`
- Modify: `src/client/index.html` (styles next to `.term-overlay`), `package.json` (add `marked`)
- Test: `test/chatui.test.ts`

**Interfaces:**
- Consumes: the Task 4 frames; `isTerminalOpen()` from src/client/term.ts.
- Produces:
```ts
export interface ChatDeps { WebSocket: typeof WebSocket }
export function openChat(opts: { sessionId: string; title: string; token: string; onClose: () => void }, deps?: ChatDeps): void;
export function isChatOpen(): boolean;
```
- Events to render, using the shapes recorded in Task 1:
  - `stream_event` text deltas append to the open claude bubble;
  - `assistant` text replaces that bubble, and its `tool_use` blocks become collapsible tool rows;
  - `user` tool_result fills the matching tool row (cut at 5000 chars);
  - `control_request` can_use_tool shows a permission card;
  - `result` adds a footer line with the cost if present, or the error if `is_error`.
- The permission card's main line is `input.command`, else `input.file_path`, else JSON.stringify(input) cut to 300 chars.

- [ ] **Step 1: Write failing tests** with happy-dom and a fake WebSocket, copying the pattern of test/term.test.ts.
  - "renders history with the old-messages divider".
  - "streams deltas then replaces with the final message".
  - "tool rows collapse and show the result".
  - "permission card sends allow/deny once and locks": click "Cho phép" → sent `{t:"allow",id}`; the card shows "Đã cho phép" and its buttons are disabled.
  - "escapes html and drops unsafe links": `<img src=x onerror=alert(1)>`, `<script>`, `[x](javascript:alert(1))` → no `img`/`script` element and no `javascript:` href; `[ok](https://a.b)` → an anchor with `target=_blank` and `rel=noopener`.
  - "Enter sends, Shift+Enter newlines, empty ignored".
  - "Stop while answering": after a send, the button reads "Dừng" and sends `{t:"stop"}`; after a `result` it reads "Gửi" again. Esc while answering also sends stop. keydown does not reach `document`.
  - "keeps scroll position when the user scrolled up".
  - "4000 locks input with the end line; error shows the connect line".
  - "✕ cleans up and calls onClose; one overlay at a time".
  - "copy button on code blocks" (stub `navigator.clipboard.writeText`).
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Run `npm i marked`, then implement:
  - configure a `marked` instance with a renderer whose `html` returns the escaped text and whose `link` drops non-http(s) hrefs;
  - fill nodes through `textContent` everywhere except the `marked` output;
  - the overlay root stops keydown propagation and refocuses the textarea on chrome clicks, as term.ts does.
- [ ] **Step 4:** Run the full suite, tsc and build. Expected: clean.
- [ ] **Step 5:** Commit `feat: Claude-Desktop-style chat overlay`.

---

### Task 6: Panel buttons and wiring

**Files:**
- Modify: `src/client/panel.ts`, `src/client/main.ts`
- Test: `test/panel.test.ts`

**Interfaces:**
- Consumes: `openChat`, `isChatOpen` (Task 5); `openTerminal`, `isTerminalOpen` (existing).
- Change the Panel's `terminal` option to `overlays?: { isOpen(): "chat" | "terminal" | null; chat(d: SessionDetail): void; terminal(d: SessionDetail): void; confirm(text: string): Promise<boolean> }`.
- `renderSession(d, now, onPick, open?: { chat(): void; terminal(): void }, openKind?: "chat" | "terminal" | null)`.

- [ ] **Step 1: Write failing tests**, rewriting the existing terminal tests.
  - "mayor panel shows Chat and Terminal": the buttons read "Chat" and "Terminal".
  - "working session confirms before either; Huỷ opens nothing; idle opens directly".
  - "while chat is open both are disabled and Chat reads 'Đang mở chat'".
  - "while the terminal is open both are disabled and Terminal reads 'Terminal đang mở'".
  - "employees get no buttons".
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - main.ts passes `isOpen: () => isChatOpen() ? "chat" : isTerminalOpen() ? "terminal" : null`.
  - Each `onClose` refreshes the panel only if it still shows that session; this fixes the parked Task-5 minor from the terminal branch.
  - `BUSY_CONFIRM` is unchanged.
- [ ] **Step 4:** Run the full suite, both tsc configs and `npm run build`. Expected: clean. Then check `grep -rn "dangerouslySetInnerHTML\|innerHTML" src/client/chat.ts`: the only `innerHTML` is the marked output.
- [ ] **Step 5:** Commit `feat: panel opens the chat or the terminal`.
- [ ] **Step 6 (controller, not the implementer):** Browser check up to the confirm dialog and the overlay opening against a fake or idle path. The user does the real-claude manual test from spec §7.
