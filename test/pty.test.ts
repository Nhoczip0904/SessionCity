import { describe, expect, it, vi } from "vitest";
import { PtyHub, type PtyProc, type PtySpawn } from "../src/server/pty.js";

function fake() {
  const procs: { proc: PtyProc; exit: (code: number) => void; kill: ReturnType<typeof vi.fn> }[] = [];
  const spawn = vi.fn<PtySpawn>(() => {
    const exits: ((e: { exitCode: number }) => void)[] = [];
    const kill = vi.fn();
    const proc: PtyProc = { onData: () => {}, onExit: (cb) => void exits.push(cb), write: () => {}, resize: () => {}, kill };
    procs.push({ proc, exit: (exitCode) => exits.forEach((f) => f({ exitCode })), kill });
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

  it("killAll kills running procs and empties the hub", () => {
    const { spawn, procs } = fake();
    const hub = new PtyHub(spawn, "c");
    hub.open("a", "c", 1, 1);
    hub.open("b", "c", 1, 1);
    hub.killAll();
    expect(procs.map((p) => p.kill.mock.calls.length)).toEqual([1, 1]);
    expect(hub.size).toBe(0);
  });
});
