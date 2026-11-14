import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { askSummary, ChatHub, type ChatProc, type ChatSpawn } from "../src/server/chat.js";
import { startServer } from "../src/server/http.js";
import { Store } from "../src/server/store.js";
import type { AskRow } from "../src/shared/types.js";

function fake() {
  const procs: { out: PassThrough; stdin: PassThrough; written: string[]; exit: () => void }[] = [];
  const spawn = vi.fn<ChatSpawn>(() => {
    const out = new PassThrough();
    const stdin = new PassThrough();
    const written: string[] = [];
    stdin.on("data", (d) => written.push(String(d)));
    const ee = new EventEmitter();
    procs.push({ out, stdin, written, exit: () => ee.emit("exit", 0) });
    return { stdout: out, stderr: new PassThrough(), stdin, pid: 1, on: (ev: string, cb: (...a: any[]) => void) => ee.on(ev, cb), kill: vi.fn() } as unknown as ChatProc;
  });
  return { spawn, procs };
}
const tick = () => new Promise((r) => setImmediate(r));
const ask = (id: string, tool = "Bash", input: unknown = { command: "npm test" }) => JSON.stringify({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: tool, input } }) + "\n";
const sent = (w: string[]) => w.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("ChatHub asks", () => {
  it("lists unanswered questions of every live process, parked ones too", async () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c");
    hub.open("b", "c")!.release();
    procs[0]!.out.write(ask("r1"));
    procs[1]!.out.write(ask("r2", "Write", { file_path: "x.txt" }));
    await tick();
    expect(hub.asks()).toEqual([
      { sid: "a", id: "r1", tool: "Bash", input: { command: "npm test" } },
      { sid: "b", id: "r2", tool: "Write", input: { file_path: "x.txt" } },
    ]);
  });

  it("answers a question while no chat window holds the process", async () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c")!.release();
    procs[0]!.out.write(ask("r1"));
    await tick();
    expect(hub.answerAsk("a", "r1", true)).toBe(true);
    expect(sent(procs[0]!.written)).toEqual([{ type: "control_response", response: { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: { command: "npm test" } } } }]);
    expect(hub.asks()).toEqual([]);
    expect(hub.answerAsk("a", "r1", true)).toBe(false); // already answered
  });

  it("deny sends a refusal; a wrong session or id answers nothing", async () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c");
    procs[0]!.out.write(ask("r1"));
    await tick();
    expect(hub.answerAsk("other", "r1", true)).toBe(false);
    expect(hub.answerAsk("a", "nope", true)).toBe(false);
    expect(procs[0]!.written).toEqual([]);
    expect(hub.answerAsk("a", "r1", false)).toBe(true);
    expect(sent(procs[0]!.written)[0].response.response.behavior).toBe("deny");
  });

  it("a process that ended takes its questions with it", async () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c");
    procs[0]!.out.write(ask("r1"));
    await tick();
    procs[0]!.exit();
    expect(hub.asks()).toEqual([]);
  });
});

describe("askSummary", () => {
  it("shows the command, else the file, else the input cut short", () => {
    expect(askSummary({ command: "ls  -la\nfoo" })).toBe("ls -la foo");
    expect(askSummary({ file_path: "D:/x/y.ts", content: "zzz" })).toBe("D:/x/y.ts");
    expect(askSummary({ a: 1 })).toBe('{"a":1}');
    expect(askSummary(undefined).length).toBeLessThan(5);
    expect(askSummary({ command: "x".repeat(500) })).toHaveLength(200);
  });
});

describe("/api/ask and the asks frame", () => {
  const TOKEN = "d".repeat(32);
  const SID = "29b8e93b-ef21-47c9-b0e5-d293accee304";
  let d: string, srv: { url: string; close(): Promise<void> }, port: number;
  let rows: AskRow[] = [{ session: SID, id: "r1", tool: "Bash", summary: "npm test" }];
  const answers: [string, string, boolean][] = [];
  beforeAll(async () => {
    d = await mkdtemp(join(tmpdir(), "asks-"));
    srv = await startServer({
      port: 0, token: TOKEN, store: new Store(), clientDir: d, claude: null, agentsDir: join(d, "a"), claudeDir: join(d, "c"), launcher: async () => {},
      asks: { list: () => rows, answer: (s, i, a) => (answers.push([s, i, a]), rows.some((r) => r.id === i)) },
    });
    port = Number(new URL(srv.url).port);
  });
  afterAll(async () => {
    await srv.close();
    await rm(d, { recursive: true, force: true });
  });
  const post = (body: unknown, h: Record<string, string> = {}, token = true) =>
    fetch(`http://127.0.0.1:${port}/api/ask${token ? `?token=${TOKEN}` : ""}`, { method: "POST", body: JSON.stringify(body), headers: { Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json", ...h } });

  it("answers a question: 200, and the hub gets the session, id and choice", async () => {
    const r = await post({ session: SID, id: "r1", allow: true });
    expect(r.status).toBe(200);
    expect(answers.at(-1)).toEqual([SID, "r1", true]);
  });
  it("404 when the question is gone", async () => {
    expect((await post({ session: SID, id: "zzz", allow: false })).status).toBe(404);
  });
  it("400 for a bad body; 401 without token; 403 for a foreign origin; GET not allowed", async () => {
    const n = answers.length;
    expect((await post({ session: "nope", id: "r1", allow: true })).status).toBe(400);
    expect((await post({ session: SID, id: "r1", allow: "yes" })).status).toBe(400);
    expect((await post({ session: SID, id: "r1", allow: true }, {}, false)).status).toBe(401);
    expect((await post({ session: SID, id: "r1", allow: true }, { Origin: "http://evil.example" })).status).toBe(403);
    expect(answers.length).toBe(n);
    expect((await fetch(`http://127.0.0.1:${port}/api/ask?token=${TOKEN}`)).status).toBe(405);
  });
  it("a new page gets the list at once, then every change", async () => {
    const frames: { type: string; asks?: AskRow[] }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
    ws.on("message", (m) => frames.push(JSON.parse(String(m))));
    await vi.waitFor(() => expect(frames.filter((f) => f.type === "asks")).toHaveLength(1));
    expect(frames.find((f) => f.type === "asks")!.asks).toEqual(rows);
    rows = [];
    await vi.waitFor(() => expect(frames.filter((f) => f.type === "asks")).toHaveLength(2), { timeout: 2000 });
    expect(frames.filter((f) => f.type === "asks").at(-1)!.asks).toEqual([]);
    ws.close();
  });
});
