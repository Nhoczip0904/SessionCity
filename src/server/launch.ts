import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { delimiter, join, resolve, isAbsolute } from "node:path";
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

export function buildLaunch(
  opts: LaunchOpts,
  env: { claude: string; wt: string | null; settingsFile?: string },
): { file: string; args: string[] } {
  const tail: string[] = [];
  if (opts.model) tail.push("--model", opts.model);
  if (env.settingsFile) tail.push("--settings", env.settingsFile);
  if (env.wt) {
    if (opts.prompt) tail.push("--", opts.prompt);
    return {
      file: env.wt,
      args: ["-w", "new", "new-tab", "-d", opts.cwd, "--title", "BackendCity", env.claude, ...tail].map(esc),
    };
  }
  // Fallback never forwards the prompt: it cannot be passed through cmd.exe safely.
  if ([opts.cwd, env.claude, env.settingsFile ?? ""].some((s) => CMD_META.test(s)))
    throw new Error("Đường dẫn chứa ký tự không an toàn");
  return { file: "cmd.exe", args: ["/c", "start", "BackendCity", "/D", opts.cwd, env.claude, ...tail] };
}

export function findOnPath(
  name: string,
  extra: string[],
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of [...exts, ""]) {
      const p = join(dir, name + ext);
      if (exists(p)) return p;
    }
  }
  return extra.find((p) => exists(p)) ?? null;
}

export function launch(
  opts: LaunchOpts,
  deps: {
    claude: string;
    wt: string | null;
    spawn: typeof nodeSpawn;
    tmpDir: string;
    setTimeout: typeof setTimeout;
  },
): Promise<void> {
  let settingsFile: string | undefined;
  const cleanup = () => {
    try {
      if (settingsFile) unlinkSync(settingsFile);
    } catch {
      /* already gone */
    }
  };
  return new Promise<void>((resolveP, reject) => {
    try {
      if (opts.subagentModel) {
        settingsFile = join(deps.tmpDir, `backendcity-${randomBytes(8).toString("hex")}.json`);
        writeFileSync(settingsFile, settingsJson(opts.subagentModel), { mode: 0o600 });
      }
      const { file, args } = buildLaunch(opts, { claude: deps.claude, wt: deps.wt, settingsFile });
      const child = deps.spawn(file, args, { detached: true, stdio: "ignore", shell: false });
      child.once("error", (e) => {
        cleanup();
        reject(e);
      });
      child.once("spawn", () => {
        child.unref();
        if (settingsFile) deps.setTimeout(cleanup, 60_000);
        resolveP();
      });
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
