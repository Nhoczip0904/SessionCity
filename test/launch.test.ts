import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLaunch, findOnPath, launch, settingsJson, validateLaunch } from "../src/server/launch.js";

const yes = () => true;
const err = (b: unknown, isDir: (p: string) => boolean = yes) => {
  const r = validateLaunch(b, isDir);
  expect(r.ok).toBe(false);
  return (r as { error: string }).error;
};

describe("validateLaunch", () => {
  it("accepts a minimal body", () => {
    expect(validateLaunch({ cwd: "D:\\p" }, yes)).toEqual({ ok: true, opts: { cwd: "D:\\p" } });
  });
  it("rejects non-objects", () => {
    for (const b of [null, "x", 1, [], undefined]) err(b);
  });
  it("rejects relative cwd", () => err({ cwd: "foo\\bar" }));
  it("rejects missing dir (isDir false)", () => err({ cwd: "D:\\nope" }, () => false));
  it("rejects UNC \\\\server\\share", () => {
    expect(err({ cwd: "\\\\server\\share" })).toContain("UNC");
    err({ cwd: "//server/share" });
  });
  it("rejects cwd ending in space or dot, but accepts a drive root", () => {
    expect(err({ cwd: "D:\\p " })).toContain("dấu cách");
    err({ cwd: "D:\\p." });
    expect(validateLaunch({ cwd: "D:\\" }, yes).ok).toBe(true);
  });
  it("rejects non-string cwd", () => err({ cwd: 5 }));
  it("rejects NUL in cwd", () => err({ cwd: "D:\\p\u0000x" }));
  it("rejects unknown model 'gpt'", () => err({ cwd: "D:\\p", model: "gpt" }));
  it("rejects subagentModel 'fable'", () => err({ cwd: "D:\\p", subagentModel: "fable" }));
  it("rejects prompt > 4000 chars", () => err({ cwd: "D:\\p", prompt: "a".repeat(4001) }));
  it("accepts prompt of exactly 4000", () => {
    expect(validateLaunch({ cwd: "D:\\p", prompt: "a".repeat(4000) }, yes).ok).toBe(true);
  });
  it("rejects prompt with \\u0007, \\u007f and lone \\r", () => {
    err({ cwd: "D:\\p", prompt: "a\u0007b" });
    err({ cwd: "D:\\p", prompt: "a\u007fb" });
    err({ cwd: "D:\\p", prompt: "a\rb" });
  });
  it("accepts \\n, \\t and \\r\\n in prompt", () => {
    expect(validateLaunch({ cwd: "D:\\p", prompt: "a\nb\tc\r\nd" }, yes).ok).toBe(true);
  });
  it("treats empty strings as absent", () => {
    expect(validateLaunch({ cwd: "D:\\p", model: "", subagentModel: "", prompt: "" }, yes)).toEqual({
      ok: true,
      opts: { cwd: "D:\\p" },
    });
  });
  it("keeps valid options", () => {
    expect(validateLaunch({ cwd: "D:\\p", model: "fable", subagentModel: "haiku", prompt: "hi" }, yes)).toEqual({
      ok: true,
      opts: { cwd: "D:\\p", model: "fable", subagentModel: "haiku", prompt: "hi" },
    });
  });
});


const NASTY = ['x" &calc "', "%USERPROFILE%", "a\tb", "trail\\", "--dangerously-skip-permissions", "a; b"];

describe("buildLaunch", () => {
  const env = { node: "C:\\Program Files\\nodejs\\node.exe", script: "D:\\app\\bin\\claude-launch.mjs", jobFile: "C:\\t\\backendcity-job-ab.json" };
  it("wt argv runs the fixed script with the job file", () =>
    expect(buildLaunch({ cwd: "D:\\Học\\Dự án x" }, { ...env, wt: "C:\\wt.exe" })).toEqual({
      file: "C:\\wt.exe",
      args: ["-w", "new", "new-tab", "-d", "D:\\Học\\Dự án x", "--title", "SessionCity", env.node, env.script, env.jobFile],
    }));
  it("escapes ; in wt args", () => {
    const { args } = buildLaunch({ cwd: "D:\\a;b" }, { ...env, jobFile: "C:\\j;k.json", wt: "C:\\wt.exe" });
    expect(args).toContain("D:\\a\\;b");
    expect(args).toContain("C:\\j\\;k.json");
  });
  it("cmd fallback uses empty title", () =>
    expect(buildLaunch({ cwd: "D:\\p" }, { ...env, wt: null })).toEqual({
      file: "cmd.exe",
      args: ["/c", "start", "", "/D", "D:\\p", env.node, env.script, env.jobFile],
    }));
  it("refuses cmd metacharacters in fallback", () => {
    expect(() => buildLaunch({ cwd: "D:\\a&b" }, { ...env, wt: null })).toThrow();
    expect(() => buildLaunch({ cwd: "D:\\p" }, { ...env, jobFile: "C:\\%x%.json", wt: null })).toThrow();
  });
  it("no user text in argv", () => {
    for (const prompt of NASTY)
      for (const wt of ["C:\\wt.exe", null]) {
        const { args } = buildLaunch({ cwd: "D:\\p", model: "opus", subagentModel: "haiku", prompt }, { ...env, wt });
        expect(args.join("\u0000")).not.toContain(prompt);
        expect(args).not.toContain("--model");
        expect(args).not.toContain("--");
      }
  });
});

it("settingsJson", () =>
  expect(JSON.parse(settingsJson("haiku"))).toEqual({ env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } }));

describe("launch", () => {
  const setup = () => {
    const handlers: Record<string, (...a: any[]) => void> = {};
    const child = {
      unref: vi.fn(),
      once: vi.fn((ev: string, fn: any) => void (handlers[ev] = fn)),
      emit: (ev: string, ...a: any[]) => handlers[ev]?.(...a),
    };
    const spawn = vi.fn((..._a: any[]) => child);
    const timers: Array<{ fn: () => void; ms: number; unref: ReturnType<typeof vi.fn> }> = [];
    const st = ((fn: () => void, ms: number) => {
      const t = { fn, ms, unref: vi.fn() };
      timers.push(t);
      return t;
    }) as unknown as typeof setTimeout;
    const tmpDir = mkdtempSync(join(tmpdir(), "bc-launch-test-"));
    return { child, spawn, timers, st, tmpDir };
  };
  const deps = (s: ReturnType<typeof setup>, wt: string | null = "C:\\wt.exe", claude = "C:\\c.exe") => ({
    claude,
    wt,
    spawn: s.spawn as any,
    tmpDir: s.tmpDir,
    setTimeout: s.st,
    node: "C:\\node.exe",
    script: "D:\\app\\bin\\claude-launch.mjs",
  });
  const argsOf = (s: ReturnType<typeof setup>) => (s.spawn.mock.calls[0] as any[])[1] as string[];

  it("spawns detached, shell false, unref called, job file passed", async () => {
    const s = setup();
    const p = launch({ cwd: "D:\\p", model: "opus", prompt: 'x" &calc "' }, deps(s));
    s.child.emit("spawn");
    await p;
    const [file, args, o] = s.spawn.mock.calls[0] as any[];
    expect(file).toBe("C:\\wt.exe");
    expect(o).toEqual({ detached: true, stdio: "ignore", shell: false });
    expect(args.slice(-3)).toEqual(["C:\\node.exe", "D:\\app\\bin\\claude-launch.mjs", args.at(-1)]);
    expect(args.join("")).not.toContain("calc");
    const jobFile = args.at(-1) as string;
    expect(jobFile.startsWith(s.tmpDir)).toBe(true);
    expect(jobFile).toMatch(/backendcity-job-[0-9a-f]{16}\.json$/);
    expect(JSON.parse(readFileSync(jobFile, "utf8"))).toEqual({ claude: "C:\\c.exe", model: "opus", prompt: 'x" &calc "' });
    if (process.platform !== "win32") expect(statSync(jobFile).mode & 0o777).toBe(0o600);
    expect(s.child.unref).toHaveBeenCalled();
  });

  it("writes settings file and job references it; fallback cleanup after 10 min, unref'd", async () => {
    const s = setup();
    const p = launch({ cwd: "D:\\p", subagentModel: "haiku" }, deps(s));
    s.child.emit("spawn");
    await p;
    const jobFile = argsOf(s).at(-1) as string;
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    expect(job.settingsFile).toMatch(/backendcity-[0-9a-f]{16}\.json$/);
    expect(JSON.parse(readFileSync(job.settingsFile, "utf8"))).toEqual({ env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } });
    expect(s.timers[0].ms).toBe(600_000);
    expect(s.timers[0].unref).toHaveBeenCalled();
    s.timers[0].fn();
    expect(existsSync(jobFile)).toBe(false);
    expect(existsSync(job.settingsFile)).toBe(false);
    s.timers[0].fn(); // already gone: no throw
  });

  it("fallback timer keeps settings file when the launcher already ran (job file gone)", async () => {
    const s = setup();
    const p = launch({ cwd: "D:\\p", subagentModel: "haiku" }, deps(s));
    s.child.emit("spawn");
    await p;
    const jobFile = argsOf(s).at(-1) as string;
    const settings = JSON.parse(readFileSync(jobFile, "utf8")).settingsFile as string;
    rmSync(jobFile); // launcher consumed the job
    s.timers[0].fn();
    expect(existsSync(settings)).toBe(true);
  });

  it("spawn error → rejects and removes job and settings", async () => {
    const s = setup();
    const p = launch({ cwd: "D:\\p", subagentModel: "haiku" }, deps(s, null));
    s.child.emit("error", new Error("ENOENT"));
    await expect(p).rejects.toThrow("ENOENT");
    expect(readdirSync(s.tmpDir)).toEqual([]);
  });

  it("spawn throwing synchronously rejects and cleans up", async () => {
    const s = setup();
    s.spawn.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(launch({ cwd: "D:\\p", subagentModel: "haiku" }, deps(s))).rejects.toThrow("boom");
    expect(readdirSync(s.tmpDir)).toEqual([]);
  });

  it("refuses a claude that is not .exe", async () => {
    const s = setup();
    await expect(launch({ cwd: "D:\\p" }, deps(s, "C:\\wt.exe", "C:\\npm\\claude.cmd"))).rejects.toThrow();
    expect(s.spawn).not.toHaveBeenCalled();
    expect(readdirSync(s.tmpDir)).toEqual([]);
  });
});

describe("findOnPath", () => {
  const env = { PATH: "C:\\a;C:\\b", PATHEXT: ".EXE;.CMD" } as NodeJS.ProcessEnv;
  it("finds via PATH + PATHEXT", () => {
    const r = findOnPath("claude", [], env, (p) => p.toLowerCase().endsWith("b\\claude.cmd"));
    expect(r?.toLowerCase()).toBe("c:\\b\\claude.cmd");
  });
  it("falls back to first existing extra, else null", () => {
    expect(findOnPath("claude", ["X1", "X2"], env, (p) => p === "X2")).toBe("X2");
    expect(findOnPath("claude", ["X1"], env, () => false)).toBeNull();
  });
  it("exts [.exe] ignores claude.cmd and finds claude.exe later on PATH", () => {
    const exists = (p: string) => /a\\claude\.cmd$/i.test(p) || /b\\claude\.exe$/i.test(p);
    expect(findOnPath("claude", [], env, exists, [".exe"])?.toLowerCase()).toBe("c:\\b\\claude.exe");
    expect(findOnPath("claude", [], env, (p) => /claude\.cmd$/i.test(p), [".exe"])).toBeNull();
  });
});
