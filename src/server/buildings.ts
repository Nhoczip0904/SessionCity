import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BuildingData, BuildingId, ChangedFile, CiRun, Doc, RepoChanges, RepoCi, RepoMigrations, Session } from "../shared/types.js";
import { alerts, books, builds, flights, tests, type Op, type Ops } from "./activity.js";
import { repoRoots, type Run } from "./prs.js";

const firstLine = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split(/\r?\n/)[0]!.slice(0, 200);

/** What each repo has changed and not committed yet; never rejects. */
export function changes(roots: string[], exec: Run): Promise<RepoChanges[]> {
  return Promise.all(roots.map(async (root): Promise<RepoChanges> => {
    const repo = basename(root);
    let status: string;
    try {
      status = await exec("git", ["status", "--porcelain=v1", "-z"], root);
    } catch (e) {
      return { repo, files: [], error: firstLine(e) || "git lỗi" };
    }
    // shortcut: numstat paths of renamed or specially-named files do not match, so they show 0 lines
    const lines = new Map<string, [number, number]>();
    for (const l of (await exec("git", ["diff", "--numstat", "HEAD"], root).catch(() => "")).split("\n")) {
      const [a, d, ...p] = l.split("\t");
      if (p.length) lines.set(p.join("\t"), [Number(a) || 0, Number(d) || 0]);
    }
    const files: ChangedFile[] = [];
    const parts = status.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i];
      if (e.length < 4) continue;
      const xy = e.slice(0, 2), path = e.slice(3);
      if (xy[0] === "R" || xy[0] === "C") i++; // the old name follows
      const [add, del] = lines.get(path) ?? [0, 0];
      files.push({ path, status: xy === "??" ? "?" : xy.includes("A") ? "A" : xy.includes("D") ? "D" : "M", add, del });
    }
    files.sort((a, b) => b.add + b.del - (a.add + a.del) || a.path.localeCompare(b.path));
    return { repo, files: files.slice(0, 60) };
  }));
}

type GhRun = { name?: string; conclusion?: string; status?: string; headBranch?: string; createdAt?: string; url?: string };

/** The latest workflow runs of each repo, via gh; never rejects. */
export function ci(roots: string[], exec: Run): Promise<RepoCi[]> {
  return Promise.all(roots.map(async (root): Promise<RepoCi> => {
    const repo = basename(root);
    try {
      const list = JSON.parse(await exec("gh", ["run", "list", "--limit", "8", "--json", "name,conclusion,status,headBranch,createdAt,url"], root)) as GhRun[];
      return {
        repo,
        runs: list.map((r): CiRun => ({
          name: r.name ?? "", branch: r.headBranch ?? "", at: r.createdAt ?? "",
          state: r.status !== "completed" ? "pending" : r.conclusion === "success" || r.conclusion === "skipped" || r.conclusion === "neutral" ? "pass" : "fail",
          url: r.url && /^https:\/\/github\.com\//.test(r.url) ? r.url : null,
        })),
      };
    } catch (e) {
      return { repo, runs: [], error: firstLine(e) || "gh lỗi" };
    }
  }));
}

const SKIP = new Set(["node_modules", "bin", "obj", "dist", "build", "out", "target", "venv", ".venv"]);
const skip = (name: string) => name.startsWith(".") || SKIP.has(name);

/** Files under `dir` (depth-limited), as [path relative to dir with "/", full path]. */
async function walk(dir: string, rel: string, depth: number, budget: { n: number }, visit: (rel: string, full: string, isDir: boolean) => void): Promise<void> {
  if (depth < 0 || budget.n-- <= 0) return;
  for (const e of await readdir(join(dir, rel), { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && skip(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    visit(r, join(dir, r), e.isDirectory());
    if (e.isDirectory()) await walk(dir, r, depth - 1, budget, visit);
  }
}

const mtime = async (f: string) => (await stat(f)).mtime.toISOString();
const DOC = /(specs?|plans?|design|rfc|proposal)/i;

/** Spec and plan documents under each repo's docs folder, newest first, with the progress of their checklists. */
export async function docs(roots: string[]): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const root of roots) {
    const found: [string, string][] = [];
    await walk(join(root, "docs"), "", 5, { n: 400 }, (rel, full, isDir) => {
      if (!isDir && /\.md$/i.test(rel) && DOC.test(rel)) found.push([rel, full]);
    });
    for (const [rel, full] of found) {
      const text = await readFile(full, "utf8").catch(() => "");
      const done = (text.match(/^\s*[-*]\s+\[[xX]\]/gm) ?? []).length;
      const open = (text.match(/^\s*[-*]\s+\[ \]/gm) ?? []).length;
      out.push({
        repo: basename(root), path: `docs/${rel}`,
        title: /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? basename(rel).replace(/\.md$/i, ""),
        done, total: done + open, at: await mtime(full).catch(() => ""),
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
}

/** Migration files of each repo (EF `Migrations`, `db/migrate`...), newest first; repos without any are left out. */
export async function migrations(roots: string[]): Promise<RepoMigrations[]> {
  const out: RepoMigrations[] = [];
  for (const root of roots) {
    const dirs: string[] = [];
    await walk(root, "", 6, { n: 3000 }, (rel, _full, isDir) => {
      if (isDir && /^migrat(ions|e)$/i.test(basename(rel))) dirs.push(rel);
    });
    const items: { name: string; at: string }[] = [];
    for (const d of dirs)
      for (const e of await readdir(join(root, d), { withFileTypes: true }).catch(() => []))
        if (e.isFile() && !/\.Designer\.cs$|Snapshot\.cs$/.test(e.name)) items.push({ name: e.name, at: await mtime(join(root, d, e.name)).catch(() => "") });
    if (items.length) out.push({ repo: basename(root), items: items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12) });
  }
  return out;
}

export interface Deps {
  sessions(): Session[];
  /** The tool calls of a session's transcript. */
  ops(sessionId: string): Promise<Op[]>;
  /** What Claude last said in the session. */
  said(sessionId: string): Promise<string>;
  exec: Run;
}

const recent = (a: Session, b: Session) => b.lastActivity.localeCompare(a.lastActivity);

/** The data behind one department's board; a source that fails leaves its part empty. */
export async function buildingData(id: BuildingId, d: Deps): Promise<BuildingData> {
  const sessions = d.sessions();
  const everyone = (): Promise<Ops[]> => Promise.all(sessions.map(async (s) => ({ project: s.project, ops: await d.ops(s.id).catch((): Op[] => []) })));
  const roots = () => repoRoots(sessions.map((s) => s.cwd), d.exec);
  switch (id) {
    case "townhall": {
      const items = await Promise.all(sessions.filter((s) => s.status === "waiting").sort(recent).map(async (s) => ({
        id: s.id, project: s.project, ...(s.title ? { title: s.title } : {}), said: await d.said(s.id).catch(() => ""), at: s.lastActivity,
      })));
      return { id, items };
    }
    case "home":
      return { id, items: sessions.filter((s) => s.status === "idle").sort(recent).map((s) => ({ id: s.id, project: s.project, ...(s.title ? { title: s.title } : {}), since: s.lastActivity })) };
    case "site":
      return { id, repos: await changes(await roots(), d.exec) };
    case "lab":
      return { id, runs: tests(await everyone()) };
    case "factory":
      return { id, runs: builds(await everyone()) };
    case "airport": {
      const [all, r] = await Promise.all([everyone(), roots()]);
      return { id, flights: flights(all), ci: await ci(r, d.exec) };
    }
    case "watchtower":
      return { id, alerts: alerts(await everyone()) };
    case "library":
      return { id, books: books(await everyone()) };
    case "design":
      return { id, docs: await docs(await roots()) };
    case "database":
      return { id, repos: await migrations(await roots()) };
  }
}

/** buildingData behind a per-department `ttl` cache; `fresh` skips it; a call still running is shared. */
export function buildingCache(d: Deps, ttl = 20_000, now = Date.now): (id: BuildingId, fresh?: boolean) => Promise<BuildingData> {
  const last = new Map<BuildingId, { at: number; done: boolean; p: Promise<BuildingData> }>();
  return (id, fresh = false) => {
    const hit = last.get(id);
    if (hit && (!hit.done || (!fresh && now() - hit.at < ttl))) return hit.p;
    const entry = { at: now(), done: false, p: buildingData(id, d) };
    last.set(id, entry);
    void entry.p.then(() => (entry.done = true), () => last.delete(id));
    return entry.p;
  };
}
