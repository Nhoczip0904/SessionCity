import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHub, type ChatProc, type ChatSpawn } from "../src/server/chat.js";

const ARGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--resume", "abc", "--permission-prompts", "host", "--permission-prompt-tool", "stdio"];

function fake() {
  const procs: { proc: ChatProc; out: PassThrough; err: PassThrough; stdin: PassThrough; written: string[]; exit: (code: number | null) => void; kill: ReturnType<typeof vi.fn>; fail: () => void }[] = [];
  const spawn = vi.fn<ChatSpawn>(() => {
    const out = new PassThrough();
    const err = new PassThrough();
    const stdin = new PassThrough();
    const written: string[] = [];
    stdin.on("data", (d) => written.push(String(d)));
    const ee = new EventEmitter();
    const kill = vi.fn();
    const proc = { stdout: out, stderr: err, stdin, pid: 4242, on: (ev: string, cb: (...a: any[]) => void) => ee.on(ev, cb), kill } as unknown as ChatProc;
    procs.push({ proc, out, err, stdin, written, exit: (c) => ee.emit("exit", c), kill, fail: () => ee.emit("error", new Error("ENOENT")) });
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
    expect(procs[1].stdin.writableEnded).toBe(true);
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

  it("a spawn error frees the slot and reports exit once", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c", 1);
    const c = hub.open("a", "c")!;
    const codes: number[] = [];
    c.onExit((x) => codes.push(x));
    procs[0].fail();
    procs[0].exit(null);
    expect(codes).toEqual([1]);
    expect(hub.size).toBe(0);
  });

  it("drains stderr so a chatty claude cannot fill the pipe", async () => {
    const { spawn, procs } = fake();
    new ChatHub(spawn, "c").open("a", "c");
    procs[0].err.write("x".repeat(1024 * 1024));
    await tick();
    expect(procs[0].err.readableLength).toBe(0);
  });

  it("onExit gets the last non-empty stderr line cut to 120 chars", async () => {
    const { spawn, procs } = fake();
    const chat = new ChatHub(spawn, "c").open("a", "c")!;
    const got: unknown[][] = [];
    chat.onExit((...a) => got.push(a));
    procs[0].err.write("first\n" + "b".repeat(200) + "\n\n  \n");
    await tick();
    procs[0].exit(2);
    expect(got).toEqual([[2, "b".repeat(120)]]);
  });

  it("isOpen tracks the session until the slot is freed", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    const a = hub.open("a", "c")!;
    hub.open("b", "c");
    expect(hub.isOpen("a")).toBe(true);
    expect(hub.isOpen("z")).toBe(false);
    a.kill();
    expect(hub.isOpen("a")).toBe(false);
    procs[1].exit(0);
    expect(hub.isOpen("b")).toBe(false);
  });
});

describe("ChatHub kill", () => {
  afterEach(() => vi.useRealTimers());
  const win = process.platform === "win32";

  it("kill ends stdin (claude exits 0 on EOF)", () => {
    const { spawn, procs } = fake();
    new ChatHub(spawn, "c", 3, vi.fn()).open("a", "c")!.kill();
    expect(procs[0].stdin.writableEnded).toBe(true);
  });

  it.runIf(win)("tree-kills the pid when claude is still alive after 2 s", () => {
    vi.useFakeTimers();
    const { spawn } = fake();
    const tk = vi.fn();
    new ChatHub(spawn, "c", 3, tk).open("a", "c")!.kill();
    vi.advanceTimersByTime(1999);
    expect(tk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tk).toHaveBeenCalledWith(4242);
  });

  it("no tree-kill when exit arrived first", () => {
    vi.useFakeTimers();
    const { spawn, procs } = fake();
    const tk = vi.fn();
    new ChatHub(spawn, "c", 3, tk).open("a", "c")!.kill();
    procs[0].exit(0);
    vi.advanceTimersByTime(5000);
    expect(tk).not.toHaveBeenCalled();
    expect(procs[0].kill).not.toHaveBeenCalled();
  });

  it.runIf(!win)("falls back to proc.kill() off Windows", () => {
    vi.useFakeTimers();
    const { spawn, procs } = fake();
    new ChatHub(spawn, "c", 3, vi.fn()).open("a", "c")!.kill();
    vi.advanceTimersByTime(2000);
    expect(procs[0].kill).toHaveBeenCalledTimes(1);
  });

  it.runIf(win)("killAll tree-kills at once", () => {
    const { spawn } = fake();
    const tk = vi.fn();
    const hub = new ChatHub(spawn, "c", 3, tk);
    hub.open("a", "c");
    hub.killAll();
    expect(tk).toHaveBeenCalledWith(4242);
    expect(hub.size).toBe(0);
  });
});

describe("ChatHub keeps a released chat alive", () => {
  afterEach(() => vi.useRealTimers());
  const ask = (id: string) => JSON.stringify({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", input: { cmd: "ls" } } }) + "\n";

  it("release parks the process: stdin stays open, slot kept, not open", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c")!.release();
    expect(procs[0].stdin.writableEnded).toBe(false);
    expect(hub.size).toBe(1);
    expect(hub.isOpen("a")).toBe(false);
  });

  it("opening the session again reuses the process; events reach only the new chat", async () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    const first = hub.open("a", "c")!;
    const old: unknown[] = [];
    first.onEvent((e) => old.push(e));
    first.release();
    const second = hub.open("a", "c")!;
    const got: unknown[] = [];
    second.onEvent((e) => got.push(e));
    procs[0].out.write('{"type":"x"}\n');
    await tick();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(hub.isOpen("a")).toBe(true);
    expect(got).toEqual([{ type: "x" }]);
    expect(old).toEqual([]);
  });

  it("a permission request left unanswered is shown again, and answerable", async () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    const first = hub.open("a", "c")!;
    first.onEvent(() => {});
    procs[0].out.write(ask("r1"));
    await tick();
    first.release();
    const second = hub.open("a", "c")!;
    const got: Record<string, unknown>[] = [];
    second.onEvent((e) => got.push(e));
    expect(got.map((e) => e.request_id)).toEqual(["r1"]);
    expect(second.pending("r1")).toBe(true);
    second.answer("r1", true);
    expect(lines(procs[0].written)[0].response.response).toEqual({ behavior: "allow", updatedInput: { cmd: "ls" } });
  });

  it("an answered request is not shown again", async () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    const first = hub.open("a", "c")!;
    first.onEvent(() => {});
    procs[0].out.write(ask("r1"));
    await tick();
    first.answer("r1", false);
    first.release();
    const got: unknown[] = [];
    hub.open("a", "c")!.onEvent((e) => got.push(e));
    expect(got).toEqual([]);
  });

  it("a released handle can no longer talk to the process", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    const first = hub.open("a", "c")!;
    first.release();
    first.say("x");
    expect(procs[0].written).toEqual([]);
  });

  it("a parked process is stopped after the park time; reopening cancels it", () => {
    vi.useFakeTimers();
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c", 3, undefined, 1000);
    hub.open("a", "c")!.release();
    hub.open("b", "c")!.release();
    hub.open("b", "c");
    vi.advanceTimersByTime(1000);
    expect(procs[0].stdin.writableEnded).toBe(true);
    expect(procs[1].stdin.writableEnded).toBe(false);
    expect(hub.size).toBe(1);
  });

  it("a full hub evicts the oldest parked process; with none parked it refuses", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c", 2);
    hub.open("a", "c")!.release();
    hub.open("b", "c")!.release();
    expect(hub.open("c", "c")).not.toBeNull();
    expect(procs[0].stdin.writableEnded).toBe(true);
    expect(procs[1].stdin.writableEnded).toBe(false);
    hub.open("d", "c");
    expect(hub.open("e", "c")).toBeNull();
  });

  it("drop stops a parked process of that session, not an attached one", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c")!.release();
    hub.open("b", "c");
    hub.drop("a");
    hub.drop("b");
    expect(procs.map((p) => p.stdin.writableEnded)).toEqual([true, false]);
  });

  it("a process that exits while parked is gone; the next open spawns afresh", () => {
    const { spawn, procs } = fake();
    const hub = new ChatHub(spawn, "c");
    hub.open("a", "c")!.release();
    procs[0].exit(0);
    expect(hub.size).toBe(0);
    hub.open("a", "c");
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
