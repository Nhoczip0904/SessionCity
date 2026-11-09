import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
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
  it("rejects non-string cwd", () => err({ cwd: 5 }));
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

describe("buildLaunch with wt", () => {
  const env = { claude: "C:\\u\\.local\\bin\\claude.exe", wt: "C:\\wt.exe" };
  it("wt argv order", () =>
    expect(buildLaunch({ cwd: "D:\\Học\\Dự án x", model: "opus", prompt: "a; b" }, env)).toEqual({
      file: "C:\\wt.exe",
      args: ["-w", "new", "new-tab", "-d", "D:\\Học\\Dự án x", "--title", "BackendCity", env.claude, "--model", "opus", "--", "a\\; b"],
    }));
  it("prompt starting with '-' stays after --", () => {
    const { args } = buildLaunch({ cwd: "D:\\p", prompt: "--model x" }, env);
    expect(args.slice(-2)).toEqual(["--", "--model x"]);
  });
  it("no model → no --model; no prompt → no --", () => {
    const { args } = buildLaunch({ cwd: "D:\\p" }, env);
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--");
  });
  it("settingsFile → --settings <file> before --", () => {
    const { args } = buildLaunch({ cwd: "D:\\p", model: "opus", prompt: "x" }, { ...env, settingsFile: "C:\\t\\s.json" });
    expect(args.slice(-6)).toEqual(["--model", "opus", "--settings", "C:\\t\\s.json", "--", "x"]);
  });
  it("semicolon in cwd escaped too", () => {
    expect(buildLaunch({ cwd: "D:\\a;b" }, env).args).toContain("D:\\a\\;b");
  });
});

describe("buildLaunch without wt", () => {
  it("cmd start fallback", () =>
    expect(buildLaunch({ cwd: "D:\\p" }, { claude: "C:\\c.exe", wt: null })).toEqual({
      file: "cmd.exe",
      args: ["/c", "start", "BackendCity", "/D", "D:\\p", "C:\\c.exe"],
    }));
  it("passes model and settings but never the prompt", () => {
    const { args } = buildLaunch(
      { cwd: "D:\\p", model: "haiku", prompt: "&calc" },
      { claude: "C:\\c.exe", wt: null, settingsFile: "C:\\s.json" },
    );
    expect(args).toEqual(["/c", "start", "BackendCity", "/D", "D:\\p", "C:\\c.exe", "--model", "haiku", "--settings", "C:\\s.json"]);
  });
  it("refuses cmd metacharacters in cwd", () => {
    expect(() => buildLaunch({ cwd: "D:\\a&b" }, { claude: "C:\\c.exe", wt: null })).toThrow();
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
    const timers: Array<[() => void, number]> = [];
    const st = ((fn: () => void, ms: number) => (timers.push([fn, ms]), 0)) as unknown as typeof setTimeout;
    const tmpDir = mkdtempSync(join(tmpdir(), "bc-launch-test-"));
    return { child, spawn, timers, st, tmpDir };
  };
  const deps = (s: ReturnType<typeof setup>, wt: string | null = "C:\\wt.exe") => ({
    claude: "C:\\c.exe",
    wt,
    spawn: s.spawn as any,
    tmpDir: s.tmpDir,
    setTimeout: s.st,
  });

  it("spawns detached, shell false, unref called", async () => {
    const s = setup();
    const p = launch({ cwd: "D:\\p" }, deps(s));
    s.child.emit("spawn");
    await p;
    const [file, args, o] = s.spawn.mock.calls[0] as any[];
    expect(file).toBe("C:\\wt.exe");
    expect(args).toContain("BackendCity");
    expect(o).toEqual({ detached: true, stdio: "ignore", shell: false });
    expect(s.child.unref).toHaveBeenCalled();
    expect(s.timers).toHaveLength(0);
  });

  it("writes settings file with subagentModel and deletes it after 60 s", async () => {
    const s = setup();
    const p = launch({ cwd: "D:\\p", subagentModel: "haiku" }, deps(s));
    s.child.emit("spawn");
    await p;
    const args = (s.spawn.mock.calls[0] as any[])[1] as string[];
    const file = args[args.indexOf("--settings") + 1];
    expect(file.startsWith(s.tmpDir)).toBe(true);
    expect(file).toMatch(/backendcity-[0-9a-f]{16}\.json$/);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } });
    expect(s.timers[0][1]).toBe(60_000);
    s.timers[0][0]();
    expect(existsSync(file)).toBe(false);
  });

  it("spawn error → launch rejects and removes settings file", async () => {
    const s = setup();
    const p = launch({ cwd: "D:\\p", subagentModel: "haiku" }, deps(s, null));
    s.child.emit("error", new Error("ENOENT"));
    await expect(p).rejects.toThrow("ENOENT");
    const args = (s.spawn.mock.calls[0] as any[])[1] as string[];
    expect(existsSync(args[args.indexOf("--settings") + 1])).toBe(false);
  });

  it("spawn throwing synchronously rejects", async () => {
    const s = setup();
    s.spawn.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(launch({ cwd: "D:\\p" }, deps(s))).rejects.toThrow("boom");
  });
});

describe("findOnPath", () => {
  const env = { PATH: "C:\\a;C:\\b", PATHEXT: ".EXE;.CMD" } as NodeJS.ProcessEnv;
  it("finds via PATH + PATHEXT", () => {
    const hits: string[] = [];
    const r = findOnPath("claude", [], env, (p) => (hits.push(p), p.toLowerCase().endsWith("b\\claude.cmd")));
    expect(r?.toLowerCase()).toBe("c:\\b\\claude.cmd");
  });
  it("falls back to first existing extra, else null", () => {
    expect(findOnPath("claude", ["X1", "X2"], env, (p) => p === "X2")).toBe("X2");
    expect(findOnPath("claude", ["X1"], env, () => false)).toBeNull();
  });
});
