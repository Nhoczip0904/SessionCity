import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { PrRow, RepoPrs } from "../shared/types.js";

/** Runs a program (no shell) in `cwd` and resolves with its stdout; rejects with `stderr` on the error when it fails. */
export type Run = (file: string, args: string[], cwd: string) => Promise<string>;

export const run: Run = (file, args, cwd) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { cwd, timeout: 15_000, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr) })) : resolve(String(stdout))));

const FIELDS = "number,title,url,author,isDraft,reviewDecision,statusCheckRollup";
const REVIEW: Record<string, PrRow["review"]> = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "pending" };
const BAD = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

type Check = { status?: string; conclusion?: string; state?: string };
type GhPr = { number: number; title: string; url: string; author?: { login?: string } | null; isDraft: boolean; reviewDecision?: string; statusCheckRollup?: Check[] };

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
  draft: p.isDraft,
  review: REVIEW[p.reviewDecision ?? ""] ?? null,
  ci: ci(p.statusCheckRollup),
});

/** The git repos the given folders are in, each once; a folder outside any repo is left out. */
export async function repoRoots(cwds: string[], exec: Run): Promise<string[]> {
  // an unknown cwd ("") would otherwise run git in the server's own folder
  const roots = await Promise.all([...new Set(cwds)].filter(Boolean).map((cwd) => exec("git", ["rev-parse", "--show-toplevel"], cwd).then((s) => s.trim(), () => null)));
  return [...new Set(roots.filter((r): r is string => !!r))];
}

/** Open PRs of every git repo the given folders are in, one gh call per repo; never rejects. */
export async function listPrs(cwds: string[], exec: Run): Promise<RepoPrs[]> {
  return Promise.all((await repoRoots(cwds, exec)).map(async (root): Promise<RepoPrs> => {
    const repo = basename(root);
    try {
      const list = JSON.parse(await exec("gh", ["pr", "list", "--state", "open", "--limit", "30", "--json", FIELDS], root)) as GhPr[];
      return { repo, prs: list.map(row) };
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split(/\r?\n/)[0]!.slice(0, 200);
      return { repo, prs: [], error: msg || "gh lỗi" };
    }
  }));
}

/** listPrs behind a `ttl` cache; `fresh` skips the cache; a call still running is shared. */
export function prCache(cwds: () => string[], exec: Run, ttl = 60_000, now = Date.now): (fresh?: boolean) => Promise<RepoPrs[]> {
  let last: { at: number; done: boolean; p: Promise<RepoPrs[]> } | null = null;
  return (fresh = false) => {
    if (last && (!last.done || (!fresh && now() - last.at < ttl))) return last.p;
    const entry = { at: now(), done: false, p: Promise.resolve().then(() => listPrs(cwds(), exec)).catch(() => []) };
    void entry.p.then(() => (entry.done = true));
    last = entry;
    return entry.p;
  };
}
