import { describe, expect, it, vi } from "vitest";
import { runJob } from "../bin/claude-launch.mjs";

const PROMPTS = ['say "hi" & %PATH%', "a\tb\nc", "trail\\", "--x", "--dangerously-skip-permissions"];

const setup = (job: unknown, files: Record<string, string> = {}) => {
  const fs = {
    files: { "job.json": typeof job === "string" ? job : JSON.stringify(job), ...files } as Record<string, string>,
    order: [] as string[],
    readFileSync(p: string) {
      if (!(p in this.files)) throw new Error("ENOENT");
      return this.files[p];
    },
    unlinkSync(p: string) {
      this.order.push("unlink:" + p);
      if (!(p in this.files)) throw new Error("ENOENT");
      delete this.files[p];
    },
  };
  const handlers: Record<string, (...a: any[]) => void> = {};
  const child = { once: vi.fn((ev: string, fn: any) => void (handlers[ev] = fn)), emit: (ev: string, ...a: any[]) => handlers[ev]?.(...a) };
  const spawn = vi.fn((..._a: any[]) => {
    fs.order.push("spawn");
    return child;
  });
  const exit = vi.fn();
  const err = vi.fn();
  return { fs, spawn, exit, err, child, deps: { fs, spawn, exit, err } as any };
};

describe("runJob", () => {
  it.each(PROMPTS)("passes prompt byte-identical after --: %j", async (prompt) => {
    const s = setup({ claude: "C:\\c.exe", model: "opus", settingsFile: "s.json", prompt }, { "s.json": "{}" });
    await runJob("job.json", s.deps);
    const [file, args, o] = s.spawn.mock.calls[0] as any[];
    expect(file).toBe("C:\\c.exe");
    expect(args).toEqual(["--model", "opus", "--settings", "s.json", "--", prompt]);
    expect(o).toEqual({ stdio: "inherit", shell: false });
  });

  it("deletes job before spawning, deletes settings on exit and exits with child code", async () => {
    const s = setup({ claude: "C:\\C.EXE", settingsFile: "s.json" }, { "s.json": "{}" });
    await runJob("job.json", s.deps);
    expect(s.fs.order).toEqual(["unlink:job.json", "spawn"]);
    expect(s.exit).not.toHaveBeenCalled();
    s.child.emit("exit", 3);
    expect(s.fs.files["s.json"]).toBeUndefined();
    expect(s.exit).toHaveBeenCalledWith(3);
  });

  it("no optional fields → no args", async () => {
    const s = setup({ claude: "c.exe" });
    await runJob("job.json", s.deps);
    expect((s.spawn.mock.calls[0] as any[])[1]).toEqual([]);
  });

  it("refuses non-.exe claude, still deletes job", async () => {
    const s = setup({ claude: "C:\\npm\\claude.cmd", prompt: "x" });
    await runJob("job.json", s.deps);
    expect(s.spawn).not.toHaveBeenCalled();
    expect(s.exit).toHaveBeenCalledWith(1);
    expect(s.err).toHaveBeenCalled();
    expect(s.fs.files["job.json"]).toBeUndefined();
  });

  it("refuses missing or invalid job", async () => {
    for (const s of [setup("{not json"), setup({ claude: "c.exe" })]) {
      if (s.deps.fs.files["job.json"].includes("claude")) delete s.fs.files["job.json"];
      await runJob("job.json", s.deps);
      expect(s.spawn).not.toHaveBeenCalled();
      expect(s.exit).toHaveBeenCalledWith(1);
    }
  });

  it("child spawn error exits 1", async () => {
    const s = setup({ claude: "c.exe" });
    await runJob("job.json", s.deps);
    s.child.emit("error", new Error("x"));
    expect(s.exit).toHaveBeenCalledWith(1);
  });
});
