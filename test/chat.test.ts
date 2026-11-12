import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ChatHub, type ChatProc, type ChatSpawn } from "../src/server/chat.js";

const ARGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--resume", "abc", "--permission-prompts", "host", "--permission-prompt-tool", "stdio"];

function fake() {
  const procs: { proc: ChatProc; out: PassThrough; written: string[]; exit: (code: number | null) => void; kill: ReturnType<typeof vi.fn> }[] = [];
  const spawn = vi.fn<ChatSpawn>(() => {
    const out = new PassThrough();
    const stdin = new PassThrough();
    const written: string[] = [];
    stdin.on("data", (d) => written.push(String(d)));
    const ee = new EventEmitter();
    const kill = vi.fn();
    const proc = { stdout: out, stdin, on: (ev: string, cb: (...a: any[]) => void) => ee.on(ev, cb), kill } as unknown as ChatProc;
    procs.push({ proc, out, written, exit: (c) => ee.emit("exit", c), kill });
    return proc;
  });
  return { spawn, procs };
}
const tick = () => new Promise((r) => setImmediate(r));
const lines = (w: string[]) => w.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("ChatHub", () => {
  it("spawns claude with the exact args", () => {
    const { spawn } = fake();
    new ChatHub(spawn, "/bin/claude").open("abc", "/proj");
    expect(spawn).toHaveBeenCalledWith("/bin/claude", ARGS, { cwd: "/proj", env: process.env, stdio: "pipe", windowsHide: true });
  });

  it("returns null when full or without claude", () => {
    expect(new ChatHub(fake().spawn, null).open("a", "c")).toBeNull();
    const hub = new ChatHub(fake().spawn, "c");
    for (let i = 0; i < 3; i++) expect(hub.open("a", "c")).not.toBeNull();
    expect(hub.open("a", "c")).toBeNull();
  });

  it("exit frees the slot; kill frees it at once and kills once", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c");
    procs[0].exit(0);
    expect(hub.size).toBe(0);
    const chat = hub.open("b", "c")!;
    expect(hub.size).toBe(1);
    chat.kill();
    chat.kill();
    expect(procs[1].kill).toHaveBeenCalledTimes(1);
    expect(hub.size).toBe(0);
  });

  it("joins split lines and multibyte chars", async () => {
    const { spawn, procs } = fake();
    const chat = new ChatHub(spawn, "c").open("a", "c")!;
    const got: unknown[] = [];
    chat.onEvent((e) => got.push(e));
    const b = Buffer.from('{"type":"a","t":"xin chào"}\n{"type":"b"}\nnot json\n');
    const cut = b.indexOf(0xc3) + 1; // split inside "à"
    procs[0].out.write(b.subarray(0, cut));
    procs[0].out.write(b.subarray(cut));
    await tick();
    expect(got).toEqual([{ type: "a", t: "xin chào" }, { type: "b" }]);
  });

  it("say / answer / interrupt write the protocol lines", async () => {
    const { spawn, procs } = fake();
    const chat = new ChatHub(spawn, "c").open("a", "c")!;
    const input = { file_path: "x.txt", content: "hi" };
    const req = (id: string) => JSON.stringify({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: "Write", input } }) + "\n";
    procs[0].out.write(req("r1") + req("r2"));
    await tick();
    chat.say("xin chào");
    chat.answer("r1", true);
    chat.answer("r2", false);
    chat.interrupt();
    expect(lines(procs[0].written)).toEqual([
      { type: "user", message: { role: "user", content: "xin chào" } },
      { type: "control_response", response: { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: input } } },
      { type: "control_response", response: { subtype: "success", request_id: "r2", response: { behavior: "deny", message: "Người dùng từ chối" } } },
      { type: "control_request", request_id: "int-1", request: { subtype: "interrupt" } },
    ]);
  });

  it("pending tracks unanswered can_use_tool ids", async () => {
    const { spawn, procs } = fake();
    const chat = new ChatHub(spawn, "c").open("a", "c")!;
    procs[0].out.write(JSON.stringify({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", input: {} } }) + "\n");
    await tick();
    expect(chat.pending("r1")).toBe(true);
    chat.answer("r1", true);
    expect(chat.pending("r1")).toBe(false);
  });

  it("answer after exit is a no-op", async () => {
    const { spawn, procs } = fake();
    const chat = new ChatHub(spawn, "c").open("a", "c")!;
    procs[0].exit(1);
    expect(() => {
      chat.say("x");
      chat.answer("r1", true);
      chat.interrupt();
    }).not.toThrow();
    expect(procs[0].written).toEqual([]);
  });
});
