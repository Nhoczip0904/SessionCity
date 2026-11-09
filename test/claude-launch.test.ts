import { describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { runJob } from "../bin/claude-launch.mjs";

const S = path.join(os.tmpdir(), "backendcity-0123456789abcdef.json");
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
    const s = setup({ claude: "C:\\c.exe", model: "opus", settingsFile: S, prompt }, { [S]: "{}" });
    await runJob("job.json", s.deps);
    const [file, args, o] = s.spawn.mock.calls[0] as any[];
    expect(file).toBe("C:\\c.exe");
    expect(args).toEqual(["--model", "opus", "--settings", S, "--", prompt]);
    expect(o).toEqual({ stdio: "inherit", shell: false });
  });

  it("deletes job before spawning, deletes settings on exit and exits with child code", async () => {
    const s = setup({ claude: "C:\\C.EXE", settingsFile: S }, { [S]: "{}" });
    await runJob("job.json", s.deps);
    expect(s.fs.order).toEqual(["unlink:job.json", "spawn"]);
    expect(s.exit).not.toHaveBeenCalled();
    s.child.emit("exit", 3);
    expect(s.fs.files[S]).toBeUndefined();
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

  describe("job validation", () => {
    const tmp = os.tmpdir();
    const goodSettings = path.join(tmp, "backendcity-0123456789abcdef.json");
    const rejects: [string, any][] = [
      ["model not an alias", { claude: "c.exe", model: "gpt" }],
      ["model not a string", { claude: "c.exe", model: 5 }],
      ["prompt not a string", { claude: "c.exe", prompt: 5 }],
      ["settingsFile outside tmpdir", { claude: "c.exe", settingsFile: "C:\\evil\\backendcity-0123456789abcdef.json" }],
      ["settingsFile bad name", { claude: "c.exe", settingsFile: path.join(tmp, "x.json") }],
      ["settingsFile not a string", { claude: "c.exe", settingsFile: 5 }],
    ];
    it.each(rejects)("rejects %s: no spawn, exit 1, job deleted", async (_n, job) => {
      const s = setup(job);
      await runJob("job.json", s.deps);
      expect(s.spawn).not.toHaveBeenCalled();
      expect(s.exit).toHaveBeenCalledWith(1);
      expect(s.err).toHaveBeenCalled();
      expect(s.fs.files["job.json"]).toBeUndefined();
    });
    it("accepts settingsFile in tmpdir (case-insensitive on Windows) with all fields", async () => {
      const f = process.platform === "win32" ? path.join(tmp.toUpperCase(), path.basename(goodSettings)) : goodSettings;
      const s = setup({ claude: "c.exe", model: "fable", settingsFile: f, prompt: "p" });
      await runJob("job.json", s.deps);
      expect((s.spawn.mock.calls[0] as any[])[1]).toEqual(["--model", "fable", "--settings", f, "--", "p"]);
    });
    it("spawn throwing -> cleans settings, exit 1", async () => {
      const s = setup({ claude: "c.exe", settingsFile: goodSettings }, { [goodSettings]: "{}" });
      s.spawn.mockImplementation(() => {
        throw new Error("boom");
      });
      await runJob("job.json", s.deps);
      expect(s.exit).toHaveBeenCalledWith(1);
      expect(s.fs.files[goodSettings]).toBeUndefined();
    });
  });
});
