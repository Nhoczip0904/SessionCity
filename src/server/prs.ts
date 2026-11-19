import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { PrInfo, PrRow, RepoPrs } from "../shared/types.js";

/** Runs a program (no shell) in `cwd` and resolves with its stdout; rejects with `stderr` on the error when it fails. */
export type Run = (file: string, args: string[], cwd: string) => Promise<string>;

export const run: Run = (file, args, cwd) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { cwd, timeout: 15_000, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr) })) : resolve(String(stdout))));

const FIELDS = "number,title,url,author,headRefName,isDraft,reviewDecision,statusCheckRollup,mergeable";
const REVIEW: Record<string, PrRow["review"]> = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "pending" };
const BAD = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

type Check = { status?: string; conclusion?: string; state?: string };
type GhPr = { number: number; title: string; url: string; author?: { login?: string } | null; headRefName?: string; isDraft: boolean; reviewDecision?: string; statusCheckRollup?: Check[]; mergeable?: string };

/** Check runs carry status + conclusion, commit statuses carry state. */
function ci(checks: Check[] = []): PrRow["ci"] {
  if (!checks.length) return null;
  if (checks.some((c) => BAD.has(c.conclusion ?? "") || BAD.has(c.state ?? ""))) return "fail";
  if (checks.some((c) => (c.state ? c.state === "PENDING" || c.state === "EXPECTED" : c.status !== "COMPLETED"))) return "pending";
  return "pass";
}

const row = (p: GhPr): PrRow => ({
  number: p.number,
  title: p.title,
  url: /^https:\/\/github\.com\//.test(p.url) ? p.url : null, // the board opens it in a new tab
  author: p.author?.login || null,
  branch: p.headRefName || null,
  draft: p.isDraft,
  review: REVIEW[p.reviewDecision ?? ""] ?? null,
  ci: ci(p.statusCheckRollup),
  conflict: p.mergeable === "CONFLICTING", // UNKNOWN while GitHub is still working it out: not flagged
});

/** The git repos the given folders are in, each once; a folder outside any repo is left out. */
export async function repoRoots(cwds: string[], exec: Run): Promise<string[]> {
  // an unknown cwd ("") would otherwise run git in the server's own folder
  const roots = await Promise.all([...new Set(cwds)].filter(Boolean).map((cwd) => exec("git", ["rev-parse", "--show-toplevel"], cwd).then((s) => s.trim(), () => null)));
  return [...new Set(roots.filter((r): r is string => !!r))];
}

/** origin (https or ssh form) → the repo page, only for github.com; anything else → null. */
export function githubUrl(remote: string): string | null {
  const m = /^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}` : null;
}

/** Open PRs of every git repo the given folders are in, one gh call per repo; never rejects. */
export async function listPrs(cwds: string[], exec: Run): Promise<RepoPrs[]> {
  return Promise.all((await repoRoots(cwds, exec)).map(async (root): Promise<RepoPrs> => {
    const repo = basename(root);
    const found = githubUrl(await exec("git", ["remote", "get-url", "origin"], root).catch(() => ""));
    const url = found ? { url: found } : {};
    try {
      const list = JSON.parse(await exec("gh", ["pr", "list", "--state", "open", "--limit", "30", "--json", FIELDS], root)) as GhPr[];
      return { repo, prs: list.map(row), ...url };
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split(/\r?\n/)[0]!.slice(0, 200);
      return { repo, prs: [], error: msg || "gh lỗi", ...url };
    }
  }));
}

const PR_LINK = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/;
const STATE: Record<string, PrInfo["state"]> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };

/** State, title and diff size of PRs given by link (any state, merged too); a link gh fails on keeps a bare row. Cached `ttl` per link. */
export function prInfoCache(exec: Run, ttl = 30_000, now = Date.now): (urls: string[], cwd: string) => Promise<PrInfo[]> {
  const seen = new Map<string, { at: number; p: Promise<PrInfo> }>();
  const one = (url: string, m: RegExpExecArray, cwd: string): Promise<PrInfo> => {
    const hit = seen.get(url);
    if (hit && now() - hit.at < ttl) return hit.p;
    const bare: PrInfo = { url, repo: m[1]!, number: Number(m[2]), title: "", state: null, additions: 0, deletions: 0 };
    const p = exec("gh", ["pr", "view", url, "--json", "number,title,state,additions,deletions"], cwd).then(
      (out) => {
        const v = JSON.parse(out) as { title?: string; state?: string; additions?: number; deletions?: number };
        return { ...bare, title: String(v.title ?? ""), state: STATE[v.state ?? ""] ?? null, additions: Number(v.additions) || 0, deletions: Number(v.deletions) || 0 };
      },
      () => bare,
    ).catch(() => bare);
    seen.set(url, { at: now(), p });
    return p;
  };
  return (urls, cwd) => Promise.all(urls.flatMap((u) => { const m = PR_LINK.exec(u); return m ? [one(u, m, cwd)] : []; }));
}

/** listPrs behind a `ttl` cache; `fresh` skips the cache; a call still running is shared. */
export function prCache(cwds: () => string[], exec: Run, ttl = 15_000, now = Date.now): (fresh?: boolean) => Promise<RepoPrs[]> {
  let last: { at: number; done: boolean; p: Promise<RepoPrs[]> } | null = null;
  return (fresh = false) => {
    if (last && (!last.done || (!fresh && now() - last.at < ttl))) return last.p;
    const entry = { at: now(), done: false, p: Promise.resolve().then(() => listPrs(cwds(), exec)).catch(() => []) };
    void entry.p.then(() => (entry.done = true));
    last = entry;
    return entry.p;
  };
}
