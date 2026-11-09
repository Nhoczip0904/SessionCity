import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { delimiter, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { spawn as nodeSpawn } from "node:child_process";

export const ALIASES = ["opus", "sonnet", "haiku", "fable"] as const;
export const SUB_ALIASES = ["haiku", "sonnet", "opus"] as const;
export type Alias = (typeof ALIASES)[number];
export type SubAlias = (typeof SUB_ALIASES)[number];
export interface LaunchOpts {
  cwd: string;
  model?: Alias;
  subagentModel?: SubAlias;
  prompt?: string;
}

const MAX_PROMPT = 4000;
// Control chars other than \n and \t are rejected; \r is allowed only as part of \r\n.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\r(?!\n)/;

export function validateLaunch(
  body: unknown,
  isDir: (p: string) => boolean,
): { ok: true; opts: LaunchOpts } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (typeof body !== "object" || body === null || Array.isArray(body)) return bad("Yêu cầu không hợp lệ");
  const b = body as Record<string, unknown>;
  const absent = (v: unknown) => v === undefined || v === null || v === "";

  if (typeof b.cwd !== "string" || !b.cwd) return bad("Thư mục phải là đường dẫn tuyệt đối");
  if (b.cwd.includes("\0")) return bad("Thư mục không hợp lệ");
  if (/^[\\/]{2}/.test(b.cwd)) return bad("Không hỗ trợ đường dẫn mạng (UNC)");
  if (!isAbsolute(b.cwd)) return bad("Thư mục phải là đường dẫn tuyệt đối");
  const cwd = resolve(b.cwd);
  if (!isDir(cwd)) return bad("Thư mục không tồn tại");
  const opts: LaunchOpts = { cwd };

  if (!absent(b.model)) {
    if (!(ALIASES as readonly unknown[]).includes(b.model)) return bad("Model không hợp lệ");
    opts.model = b.model as Alias;
  }
  if (!absent(b.subagentModel)) {
    if (!(SUB_ALIASES as readonly unknown[]).includes(b.subagentModel)) return bad("Model nhân viên không hợp lệ");
    opts.subagentModel = b.subagentModel as SubAlias;
  }
  if (!absent(b.prompt)) {
    if (typeof b.prompt !== "string") return bad("Yêu cầu không hợp lệ");
    if (b.prompt.length > MAX_PROMPT) return bad("Yêu cầu tối đa 4000 ký tự");
    if (BAD_CHARS.test(b.prompt)) return bad("Yêu cầu chứa ký tự không hợp lệ");
    opts.prompt = b.prompt;
  }
  return { ok: true, opts };
}

export const settingsJson = (sub: SubAlias): string =>
  JSON.stringify({ env: { CLAUDE_CODE_SUBAGENT_MODEL: sub } });

// wt splits commands on ";", so every ";" in an argument is escaped.
const esc = (s: string) => s.replace(/;/g, "\\;");
// cmd.exe /c start re-parses its line; unquoted metacharacters would run commands.
const CMD_META = /[&|<>^%!()"]/;

// Only fixed paths go through wt/cmd; user text travels in the job file read by bin/claude-launch.mjs.
export function buildLaunch(
  opts: LaunchOpts,
  env: { node: string; script: string; jobFile: string; wt: string | null },
): { file: string; args: string[] } {
  const run = [env.node, env.script, env.jobFile];
  if (env.wt)
    return { file: env.wt, args: ["-w", "new", "new-tab", "-d", opts.cwd, "--title", "BackendCity", ...run].map(esc) };
  if ([opts.cwd, ...run].some((s) => CMD_META.test(s))) throw new Error("Đường dẫn chứa ký tự không an toàn");
  return { file: "cmd.exe", args: ["/c", "start", "", "/D", opts.cwd, ...run] };
}

export function findOnPath(
  name: string,
  extra: string[],
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  exts?: string[], // restrict candidates (e.g. [".exe"]); default is PATHEXT plus the bare name
): string | null {
  const list =
    exts ?? [...(process.platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : []), ""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of list) {
      const p = join(dir, name + ext);
      if (exists(p)) return p;
    }
  }
  return extra.find((p) => exists(p)) ?? null;
}

const SCRIPT = fileURLToPath(new URL("../../bin/claude-launch.mjs", import.meta.url));
const FALLBACK_CLEANUP_MS = 10 * 60_000;

export function launch(
  opts: LaunchOpts,
  deps: {
    claude: string;
    wt: string | null;
    spawn: typeof nodeSpawn;
    tmpDir: string;
    setTimeout: typeof setTimeout;
    node?: string;
    script?: string;
  },
): Promise<void> {
  const files: string[] = [];
  const cleanup = () => {
    for (const f of files) {
      try {
        unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
  };
  const write = (prefix: string, content: string) => {
    const f = join(deps.tmpDir, `${prefix}-${randomBytes(8).toString("hex")}.json`);
    writeFileSync(f, content, { mode: 0o600, flag: "wx" });
    files.push(f);
    return f;
  };
  return new Promise<void>((resolveP, reject) => {
    try {
      if (!/\.exe$/i.test(deps.claude)) throw new Error("Đường dẫn claude phải là tệp .exe");
      const settingsFile = opts.subagentModel ? write("backendcity", settingsJson(opts.subagentModel)) : undefined;
      const job = { claude: deps.claude, model: opts.model, settingsFile, prompt: opts.prompt };
      const jobFile = write("backendcity-job", JSON.stringify(job));
      const { file, args } = buildLaunch(opts, {
        node: deps.node ?? process.execPath,
        script: deps.script ?? SCRIPT,
        jobFile,
        wt: deps.wt,
      });
      const child = deps.spawn(file, args, { detached: true, stdio: "ignore", shell: false });
      child.once("error", (e) => {
        cleanup();
        reject(e);
      });
      child.once("spawn", () => {
        child.unref();
        // the job file is normally deleted by the launcher; this only covers a launcher that never ran
        (deps.setTimeout(cleanup, FALLBACK_CLEANUP_MS) as { unref?: () => void } | undefined)?.unref?.();
        resolveP();
      });
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
