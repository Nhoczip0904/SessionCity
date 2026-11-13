import { afterEach, describe, expect, it, vi } from "vitest";
import { PtyHub, type PtyProc, type PtySpawn } from "../src/server/pty.js";

function fake() {
  const procs: { proc: PtyProc; exit: (code: number) => void; data: (d: string) => void; kill: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> }[] = [];
  const spawn = vi.fn<PtySpawn>(() => {
    const exits: ((e: { exitCode: number }) => void)[] = [];
    const datas: ((d: string) => void)[] = [];
    const kill = vi.fn();
    const write = vi.fn();
    const resize = vi.fn();
    const proc: PtyProc = { onData: (cb) => void datas.push(cb), onExit: (cb) => void exits.push(cb), write, resize, kill };
    procs.push({ proc, exit: (exitCode) => exits.forEach((f) => f({ exitCode })), data: (d) => datas.forEach((f) => f(d)), kill, write, resize });
    return proc;
  });
  return { spawn, procs };
}

describe("PtyHub", () => {
  it("spawns claude --resume with fixed options", () => {
    const { spawn } = fake();
    new PtyHub(spawn, "/bin/claude").open("abc", "/proj", 100, 30);
    expect(spawn).toHaveBeenCalledWith("/bin/claude", ["--resume", "abc"], {
      name: "xterm-256color", cols: 100, rows: 30, cwd: "/proj", env: process.env,
    });
  });

  it("returns null without claude or at the limit", () => {
    expect(new PtyHub(fake().spawn, null).open("a", "c", 1, 1)).toBeNull();
    const hub = new PtyHub(fake().spawn, "c");
    for (let i = 0; i < 3; i++) expect(hub.open("a", "c", 1, 1)).not.toBeNull();
    expect(hub.size).toBe(3);
    expect(hub.open("a", "c", 1, 1)).toBeNull();
  });

  it("frees the slot on exit and reports the code", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c", 1);
    const codes: number[] = [];
    hub.open("a", "c", 1, 1)!.onExit((c) => codes.push(c));
    procs[0].exit(7);
    expect(codes).toEqual([7]);
    expect(hub.size).toBe(0);
    expect(hub.open("b", "c", 1, 1)).not.toBeNull();
  });

  it("kill skips an exited proc and kills a running one once", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    const a = hub.open("a", "c", 1, 1)!;
    procs[0].exit(0);
    a.kill();
    expect(procs[0].kill).not.toHaveBeenCalled();
    const b = hub.open("b", "c", 1, 1)!;
    b.kill();
    b.kill();
    expect(procs[1].kill).toHaveBeenCalledTimes(1);
  });

  it("kill frees the slot without waiting for the exit event", () => {
    const { spawn } = fake();
    const hub = new PtyHub(spawn, "c", 1);
    hub.open("a", "c", 1, 1)!.kill();
    expect(hub.size).toBe(0);
    expect(hub.open("b", "c", 1, 1)).not.toBeNull();
  });

  it("killAll kills running procs and empties the hub", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    hub.open("a", "c", 1, 1);
    hub.open("b", "c", 1, 1);
    hub.killAll();
    expect(procs.map((p) => p.kill.mock.calls.length)).toEqual([1, 1]);
    expect(hub.size).toBe(0);
  });

  it("write and resize after exit do not reach the proc", () => {
    const { spawn, procs } = fake();
    const t = new PtyHub(spawn, "c").open("a", "c", 1, 1)!;
    t.write("x");
    t.resize(2, 2);
    expect([procs[0].write.mock.calls.length, procs[0].resize.mock.calls.length]).toEqual([1, 1]);
    procs[0].exit(0);
    t.write("y");
    t.resize(3, 3);
    expect([procs[0].write.mock.calls.length, procs[0].resize.mock.calls.length]).toEqual([1, 1]);
  });

  it("isOpen tracks the session until the slot is freed", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    const a = hub.open("a", "c", 1, 1)!;
    hub.open("b", "c", 1, 1);
    expect(hub.isOpen("a")).toBe(true);
    expect(hub.isOpen("z")).toBe(false);
    a.kill();
    expect(hub.isOpen("a")).toBe(false);
    procs[1].exit(0);
    expect(hub.isOpen("b")).toBe(false);
  });
});

describe("PtyHub keeps a released terminal alive", () => {
  afterEach(() => vi.useRealTimers());

  it("release parks the proc: not killed, slot kept, not open", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    hub.open("a", "c", 80, 24)!.release();
    expect(procs[0].kill).not.toHaveBeenCalled();
    expect(hub.size).toBe(1);
    expect(hub.isOpen("a")).toBe(false);
  });

  it("opening the session again reuses the proc, redraws it, and routes output to the new terminal", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    const first = hub.open("a", "c", 80, 24)!;
    const old: string[] = [];
    first.onData((d) => old.push(d));
    first.release();
    const second = hub.open("a", "c", 100, 30)!;
    const got: string[] = [];
    second.onData((d) => got.push(d));
    procs[0].data("hello");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(hub.isOpen("a")).toBe(true);
    expect(got).toEqual(["hello"]);
    expect(old).toEqual([]);
    // a resize to a different size and back makes the TUI repaint the empty screen
    expect(procs[0].resize.mock.calls).toEqual([[101, 30], [100, 30]]);
  });

  it("a released handle can no longer write or resize", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    const first = hub.open("a", "c", 80, 24)!;
    first.release();
    hub.open("a", "c", 80, 24);
    procs[0].write.mockClear();
    first.write("x");
    first.resize(5, 5);
    expect(procs[0].write).not.toHaveBeenCalled();
  });

  it("a parked proc is killed after the park time", () => {
    vi.useFakeTimers();
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c", 3, 1000);
    hub.open("a", "c", 1, 1)!.release();
    vi.advanceTimersByTime(999);
    expect(procs[0].kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(procs[0].kill).toHaveBeenCalledTimes(1);
    expect(hub.size).toBe(0);
  });

  it("reopening cancels the park timer", () => {
    vi.useFakeTimers();
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c", 3, 1000);
    hub.open("a", "c", 1, 1)!.release();
    hub.open("a", "c", 1, 1);
    vi.advanceTimersByTime(5000);
    expect(procs[0].kill).not.toHaveBeenCalled();
  });

  it("a full hub evicts the oldest parked proc; with none parked it refuses", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c", 2);
    hub.open("a", "c", 1, 1)!.release();
    hub.open("b", "c", 1, 1)!.release();
    expect(hub.open("c", "c", 1, 1)).not.toBeNull();
    expect(procs[0].kill).toHaveBeenCalledTimes(1);
    expect(procs[1].kill).not.toHaveBeenCalled();
    hub.open("d", "c", 1, 1); // evicts b; c and d are now attached
    expect(hub.open("e", "c", 1, 1)).toBeNull();
  });

  it("drop kills a parked proc of that session only", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    hub.open("a", "c", 1, 1)!.release();
    hub.open("b", "c", 1, 1)!.release();
    hub.drop("a");
    expect(procs.map((p) => p.kill.mock.calls.length)).toEqual([1, 0]);
    expect(hub.size).toBe(1);
  });

  it("drop leaves an attached terminal alone", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    hub.open("a", "c", 1, 1);
    hub.drop("a");
    expect(procs[0].kill).not.toHaveBeenCalled();
  });

  it("a proc that exits while parked is gone; the next open spawns afresh", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    hub.open("a", "c", 1, 1)!.release();
    procs[0].exit(0);
    expect(hub.size).toBe(0);
    hub.open("a", "c", 1, 1);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("killAll also kills parked procs", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    hub.open("a", "c", 1, 1)!.release();
    hub.killAll();
    expect(procs[0].kill).toHaveBeenCalledTimes(1);
  });
});
