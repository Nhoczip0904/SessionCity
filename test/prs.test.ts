import { describe, expect, it, vi } from "vitest";
import { githubUrl, listPrs, prCache, prInfoCache, type Run } from "../src/server/prs.js";

const pr = (n: number, extra: object = {}) => ({ number: n, title: `PR ${n}`, url: `https://github.com/o/r/pull/${n}`, isDraft: false, reviewDecision: "", statusCheckRollup: [], ...extra });

/** git maps cwd → repo root (or fails: not a repo); gh maps repo root → PR list JSON (or an Error). */
function fakeRun(roots: Record<string, string>, prs: Record<string, unknown[] | Error>): Run & { calls: string[] } {
  const calls: string[] = [];
  const run = (async (file: string, _args: string[], cwd: string) => {
    calls.push(`${file} ${cwd}`);
    if (file === "git") {
      if (!(cwd in roots)) throw new Error("fatal: not a git repository");
      return roots[cwd] + "\n";
    }
    const r = prs[cwd];
    if (r instanceof Error) throw r;
    return JSON.stringify(r ?? []);
  }) as Run & { calls: string[] };
  run.calls = calls;
  return run;
}

describe("PR details of one session", () => {
  const view = (n: number, over: object = {}) => JSON.stringify({ number: n, title: `T${n}`, state: "MERGED", additions: 5, deletions: 2, ...over });
  it("reads state, title and diff size of each link, with repo and number from the link; a failing link keeps a bare row", async () => {
    const seen: string[] = [];
    const exec: Run = async (file, args) => {
      seen.push(`${file} ${args.join(" ")}`);
      if (args.includes("https://github.com/o/r/pull/2")) throw new Error("not found");
      return args.includes("https://github.com/o/r/pull/3") ? view(3, { state: "OPEN" }) : view(1);
    };
    const get = prInfoCache(exec);
    const rows = await get(["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2", "https://github.com/o/r/pull/3"], "C:/a");
    expect(rows).toEqual([
      { url: "https://github.com/o/r/pull/1", repo: "o/r", number: 1, title: "T1", state: "merged", additions: 5, deletions: 2 },
      { url: "https://github.com/o/r/pull/2", repo: "o/r", number: 2, title: "", state: null, additions: 0, deletions: 0 },
      { url: "https://github.com/o/r/pull/3", repo: "o/r", number: 3, title: "T3", state: "open", additions: 5, deletions: 2 },
    ]);
    expect(seen[0]).toBe("gh pr view https://github.com/o/r/pull/1 --json number,title,state,additions,deletions");
  });
  it("asks gh once per link within the ttl, and again after it", async () => {
    let n = 0, t = 0;
    const exec: Run = async () => (n++, view(1));
    const get = prInfoCache(exec, 1000, () => t);
    const u = ["https://github.com/o/r/pull/1"];
    await get(u, "C:/a"); await get(u, "C:/a");
    expect(n).toBe(1);
    t = 2000;
    await get(u, "C:/a");
    expect(n).toBe(2);
  });
  it("skips anything that is not a GitHub PR link", async () => {
    const exec: Run = async () => { throw new Error("must not run"); };
    expect(await prInfoCache(exec)(["--evil", "https://evil.example/o/r/pull/1"], "C:/a")).toEqual([]);
  });
});

describe("PR board data", () => {
  it("one gh call per repo: sessions in the same repo share it; folders outside git are skipped", async () => {
    const run = fakeRun({ "C:/a": "C:/a", "C:/a/sub": "C:/a", "C:/b": "C:/b" }, { "C:/a": [pr(1)], "C:/b": [] });
    const out = await listPrs(["C:/a", "C:/a/sub", "", "C:/b", "C:/tmp", "C:/a"], run);
    expect(out.map((r) => [r.repo, r.prs.length])).toEqual([["a", 1], ["b", 0]]);
    expect(run.calls.filter((c) => c.startsWith("gh"))).toEqual(["gh C:/a", "gh C:/b"]);
    expect(run.calls).not.toContain("git ");
  });

  it("maps draft, review decision and CI checks to short states", async () => {
    const rows = [
      pr(1, { isDraft: true, author: { login: "huy", name: "Huy" } }),
      pr(2, { reviewDecision: "APPROVED", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }] }),
      pr(3, { reviewDecision: "CHANGES_REQUESTED", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "FAILURE" }] }),
      pr(4, { reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: "" }] }),
      pr(5, { statusCheckRollup: [{ state: "ERROR" }] }),
      pr(6, { statusCheckRollup: [{ state: "PENDING" }, { status: "COMPLETED", conclusion: "SKIPPED" }] }),
      pr(7, { mergeable: "CONFLICTING" }),
      pr(8, { mergeable: "UNKNOWN" }),
    ];
    const [repo] = await listPrs(["C:/a"], fakeRun({ "C:/a": "C:/a" }, { "C:/a": rows }));
    expect(repo!.prs.map((p) => [p.number, p.draft, p.review, p.ci])).toEqual([
      [1, true, null, null],
      [2, false, "approved", "pass"],
      [3, false, "changes", "fail"],
      [4, false, "pending", "pending"],
      [5, false, null, "fail"],
      [6, false, null, "pending"],
      [7, false, null, null],
      [8, false, null, null],
    ]);
    expect(repo!.prs.map((p) => p.conflict)).toEqual([false, false, false, false, false, false, true, false]);
    expect(repo!.prs[0]).toMatchObject({ title: "PR 1", url: "https://github.com/o/r/pull/1", author: "huy" });
    expect(repo!.prs[1]!.author).toBeNull(); // no author in the JSON (deleted account)
    expect(repo!.prs[0]!.branch).toBeNull(); // no headRefName in the JSON
  });

  it("carries the PR's branch so the board can match it to sessions", async () => {
    const [repo] = await listPrs(["C:/a"], fakeRun({ "C:/a": "C:/a" }, { "C:/a": [pr(7, { headRefName: "feat/x" })] }));
    expect(repo!.prs[0]!.branch).toBe("feat/x");
  });

  it("a repo gh cannot read shows its error line; the other repos still load", async () => {
    const err = Object.assign(new Error("Command failed"), { stderr: "no git remotes found\nmore detail" });
    const out = await listPrs(["C:/a", "C:/b"], fakeRun({ "C:/a": "C:/a", "C:/b": "C:/b" }, { "C:/a": err, "C:/b": [pr(7)] }));
    expect(out).toEqual([
      { repo: "a", prs: [], error: "no git remotes found" },
      expect.objectContaining({ repo: "b", prs: [expect.objectContaining({ number: 7 })] }),
    ]);
  });

  it("each repo carries its GitHub address when origin is on GitHub", async () => {
    const run: Run = async (file, args) => {
      if (file === "git") return args[0] === "remote" ? "git@github.com:o/city.git" : "C:/a";
      return "[]";
    };
    expect(await listPrs(["C:/a"], run)).toEqual([{ repo: "a", prs: [], url: "https://github.com/o/city" }]);
    expect(githubUrl("https://github.com/o/city.git")).toBe("https://github.com/o/city");
    expect(githubUrl("https://user@github.com/o/city")).toBe("https://github.com/o/city");
    expect(githubUrl("ssh://git@github.com/o/city.git")).toBe("https://github.com/o/city");
    expect(githubUrl("https://gitlab.com/o/city")).toBeNull();
    expect(githubUrl("https://github.com.evil.io/o/city")).toBeNull();
    expect(githubUrl("javascript:alert(1)")).toBeNull();
  });

  it("only GitHub PR links pass through as links", async () => {
    const [repo] = await listPrs(["C:/a"], fakeRun({ "C:/a": "C:/a" }, { "C:/a": [pr(1, { url: "javascript:alert(1)" })] }));
    expect(repo!.prs[0]!.url).toBeNull();
  });

  it("the cache answers for 60 s; a refresh asks gh again; calls already running are shared", async () => {
    let now = 0;
    const run = fakeRun({ "C:/a": "C:/a" }, { "C:/a": [pr(1)] });
    const get = prCache(() => ["C:/a"], run, 60_000, () => now);
    const ghCalls = () => run.calls.filter((c) => c.startsWith("gh")).length;
    await Promise.all([get(), get(true)]);
    expect(ghCalls()).toBe(1);
    now = 59_000;
    await get();
    expect(ghCalls()).toBe(1);
    await get(true);
    expect(ghCalls()).toBe(2);
    now = 200_000;
    await get();
    expect(ghCalls()).toBe(3);
  });

  it("never rejects, even when the session list cannot be read", async () => {
    const get = prCache(() => { throw new Error("boom"); }, vi.fn() as never);
    await expect(get()).resolves.toEqual([]);
  });
});
