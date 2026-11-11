import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Shelf, ShelfFile, ShelfSkill } from "../shared/types.js";

type Found = Omit<ShelfSkill, "used"> & { path: string };
const MAX_SKILLS = 300;
const MAX_DESC = 200;
const READ_CAP = 64 * 1024;

export const shelfId = (absPath: string) => createHash("sha256").update(absPath).digest("hex").slice(0, 16);

/** Size of a regular (non-symlink) file, else undefined. */
async function fileSize(p: string): Promise<number | undefined> {
  try {
    const st = await lstat(p);
    return st.isFile() ? st.size : undefined;
  } catch {
    return undefined;
  }
}

function frontmatter(text: string): { name?: string; description?: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const out: { name?: string; description?: string } = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const m = /^(name|description):\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1] as "name" | "description"] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

async function skillsIn(base: string, scope: ShelfSkill["scope"], plugin: string | undefined, out: Found[]) {
  let dirs: string[];
  try {
    dirs = (await readdir(join(base, "skills"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return;
  }
  for (const d of dirs) {
    if (out.length >= MAX_SKILLS) return;
    const p = join(base, "skills", d, "SKILL.md");
    if ((await fileSize(p)) === undefined) continue;
    let text: string;
    try {
      text = await readFile(p, "utf8");
    } catch {
      continue;
    }
    const fm = frontmatter(text);
    const s: Found = { id: shelfId(p), path: p, scope, name: fm.name || d, description: (fm.description ?? "").slice(0, MAX_DESC) };
    if (plugin) s.plugin = plugin;
    out.push(s);
  }
}

async function pluginRoots(claudeDir: string): Promise<{ plugin: string; path: string }[]> {
  try {
    const j = JSON.parse(await readFile(join(claudeDir, "plugins", "installed_plugins.json"), "utf8")) as { plugins?: Record<string, { installPath?: unknown }[]> };
    const roots: { plugin: string; path: string }[] = [];
    for (const [key, list] of Object.entries(j.plugins ?? {}))
      if (Array.isArray(list))
        for (const x of list) if (typeof x?.installPath === "string") roots.push({ plugin: key.split("@")[0]!, path: x.installPath });
    return roots;
  } catch {
    return [];
  }
}

/** Paths come only from server-side discovery; the id is the only thing a client supplies. */
async function discover(cwd: string | undefined, claudeDir: string) {
  const files: ShelfFile[] = [];
  const seen = new Set<string>(); // first scope wins when paths overlap (e.g. cwd under home)
  const add = async (scope: ShelfFile["scope"], p: string) => {
    if (seen.has(p)) return;
    const size = await fileSize(p);
    if (size === undefined) return;
    seen.add(p);
    files.push({ id: shelfId(p), scope, path: p, size });
  };
  await add("user", join(claudeDir, "CLAUDE.md"));
  if (cwd) {
    let dir = resolve(cwd);
    for (;;) {
      await add("project", join(dir, "CLAUDE.md"));
      await add("project", join(dir, ".claude", "CLAUDE.md"));
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    await add("local", join(cwd, "CLAUDE.local.md"));
  }
  const skills: Found[] = [];
  await skillsIn(claudeDir, "user", undefined, skills);
  if (cwd) await skillsIn(join(cwd, ".claude"), "project", undefined, skills);
  for (const r of await pluginRoots(claudeDir)) await skillsIn(r.path, "plugin", r.plugin, skills);
  const ids = new Set<string>();
  return { files, skills: skills.filter((k) => !ids.has(k.id) && ids.add(k.id)) };
}

export async function listShelf(cwd: string | undefined, claudeDir: string, used: string[]): Promise<Shelf> {
  const { files, skills } = await discover(cwd, claudeDir);
  const u = new Set(used);
  const all = skills.map(({ path: _p, ...s }) => ({ ...s, used: u.has(s.name) || (s.plugin !== undefined && u.has(`${s.plugin}:${s.name}`)) }));
  all.sort((a, b) => Number(b.used) - Number(a.used) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { files, skills: all };
}

export async function readShelfItem(cwd: string | undefined, claudeDir: string, id: string): Promise<{ text: string; truncated: boolean } | null> {
  const { files, skills } = await discover(cwd, claudeDir);
  const path = files.find((f) => f.id === id)?.path ?? skills.find((s) => s.id === id)?.path;
  if (!path) return null;
  try {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(READ_CAP + 1);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return { text: buf.subarray(0, Math.min(bytesRead, READ_CAP)).toString("utf8"), truncated: bytesRead > READ_CAP };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}
