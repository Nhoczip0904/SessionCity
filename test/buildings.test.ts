import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/shared/types.js";
import type { Op } from "../src/server/activity.js";
import { buildingCache, buildingData, changes, ci, docs, migrations, type Deps } from "../src/server/buildings.js";
import type { Run } from "../src/server/prs.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bld-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const exec = (answers: Record<string, string | Error>): Run => async (file, args) => {
  const a = answers[`${file} ${args.join(" ")}`];
  if (a === undefined) throw new Error(`unexpected: ${file} ${args.join(" ")}`);
  if (a instanceof Error) throw a;
  return a;
};

describe("changes", () => {
  const status = " M a.ts\0A  b.ts\0?? c.txt\0 D d.ts\0R  new.ts\0old.ts\0";
  const numstat = "3\t1\ta.ts\n10\t0\tb.ts\n-\t-\tbin.png\n";

  it("lists changed files with their kind and line counts, the biggest change first", async () => {
    const [r] = await changes(["/r/app"], exec({ "git status --porcelain=v1 -z": status, "git diff --numstat HEAD": numstat }));
    expect(r.repo).toBe("app");
    expect(r.files).toEqual([
      { path: "b.ts", status: "A", add: 10, del: 0 },
      { path: "a.ts", status: "M", add: 3, del: 1 },
      { path: "c.txt", status: "?", add: 0, del: 0 },
      { path: "d.ts", status: "D", add: 0, del: 0 },
      { path: "new.ts", status: "M", add: 0, del: 0 },
    ]);
  });

  it("says why when git fails, and shows a clean repo as no files", async () => {
    const [bad, clean] = await changes(["/r/bad", "/r/clean"], async (_f, args, cwd) => {
      if (cwd === "/r/bad") throw Object.assign(new Error("x"), { stderr: "fatal: not a repo\nmore" });
      return args[0] === "status" ? "" : "";
    });
    expect(bad).toEqual({ repo: "bad", files: [], error: "fatal: not a repo" });
    expect(clean).toEqual({ repo: "clean", files: [] });
  });

  it("keeps at most 60 files per repo", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ` M f${i}.ts\0`).join("");
    const [r] = await changes(["/r/x"], async (_f, args) => (args[0] === "status" ? many : ""));
    expect(r.files.length).toBe(60);
  });
});

describe("ci", () => {
  const runs = JSON.stringify([
    { name: "CI", conclusion: "success", status: "completed", headBranch: "main", createdAt: "2026-11-13T10:00:00Z", url: "https://github.com/o/r/actions/runs/1" },
    { name: "CI", conclusion: "", status: "in_progress", headBranch: "dev", createdAt: "2026-11-13T11:00:00Z", url: "https://evil.example/x" },
    { name: "Deploy", conclusion: "failure", status: "completed", headBranch: "main", createdAt: "2026-11-13T09:00:00Z", url: "https://github.com/o/r/actions/runs/3" },
  ]);

  it("lists the latest workflow runs of each repo", async () => {
    const [r] = await ci(["/r/app"], exec({ "gh run list --limit 8 --json name,conclusion,status,headBranch,createdAt,url": runs }));
    expect(r.runs.map((x) => [x.name, x.state, x.branch])).toEqual([["CI", "pass", "main"], ["CI", "pending", "dev"], ["Deploy", "fail", "main"]]);
    expect(r.runs[1].url).toBeNull(); // only github.com links are kept
    expect(r.runs[0].url).toBe("https://github.com/o/r/actions/runs/1");
  });

  it("says why when gh fails", async () => {
    const [r] = await ci(["/r/app"], async () => {
      throw Object.assign(new Error("x"), { stderr: "gh: not logged in\nrun gh auth login" });
    });
    expect(r).toEqual({ repo: "app", runs: [], error: "gh: not logged in" });
  });
});

describe("docs", () => {
  it("finds specs and plans under docs, with their title and checklist progress, newest first", async () => {
    await mkdir(join(dir, "docs", "superpowers", "specs"), { recursive: true });
    await mkdir(join(dir, "docs", "superpowers", "plans"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg", "docs", "specs"), { recursive: true });
    await writeFile(join(dir, "docs", "superpowers", "specs", "a-design.md"), "# Terminal design\n\nprose\n");
    await writeFile(join(dir, "docs", "superpowers", "plans", "b-plan.md"), "# Plan\n- [x] one\n- [X] two\n- [ ] three\n");
    await writeFile(join(dir, "docs", "notes.md"), "# Just notes\n");
    await writeFile(join(dir, "README.md"), "# Readme\n");
    await writeFile(join(dir, "node_modules", "pkg", "docs", "specs", "x.md"), "# Not ours\n");
    await utimes(join(dir, "docs", "superpowers", "specs", "a-design.md"), new Date("2026-11-10T00:00:00Z"), new Date("2026-11-10T00:00:00Z"));
    await utimes(join(dir, "docs", "superpowers", "plans", "b-plan.md"), new Date("2026-11-12T00:00:00Z"), new Date("2026-11-12T00:00:00Z"));
    const found = await docs([dir]);
    expect(found.map((d) => [d.title, d.done, d.total])).toEqual([["Plan", 2, 3], ["Terminal design", 0, 0]]);
    expect(found[0].path).toBe("docs/superpowers/plans/b-plan.md");
    expect(found[0].repo).toBe(dir.split(/[\\/]/).pop());
  });

  it("falls back to the file name when there is no title, and returns nothing without a docs folder", async () => {
    expect(await docs([dir])).toEqual([]);
    await mkdir(join(dir, "docs", "plans"), { recursive: true });
    await writeFile(join(dir, "docs", "plans", "x-plan.md"), "no heading\n");
    expect((await docs([dir]))[0].title).toBe("x-plan");
  });
});

describe("migrations", () => {
  it("lists migration files newest first, leaving out designer and snapshot files", async () => {
    const m = join(dir, "Api", "Migrations");
    await mkdir(m, { recursive: true });
    await mkdir(join(dir, "db", "migrate"), { recursive: true });
    await mkdir(join(dir, "bin", "Migrations"), { recursive: true });
    await writeFile(join(m, "20260101_Init.cs"), "");
    await writeFile(join(m, "20260101_Init.Designer.cs"), "");
    await writeFile(join(m, "AppDbContextModelSnapshot.cs"), "");
    await writeFile(join(m, "20260301_AddUsers.cs"), "");
    await writeFile(join(dir, "db", "migrate", "001_x.sql"), "");
    await writeFile(join(dir, "bin", "Migrations", "old.cs"), "");
    await utimes(join(m, "20260101_Init.cs"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    await utimes(join(m, "20260301_AddUsers.cs"), new Date("2026-03-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"));
    await utimes(join(dir, "db", "migrate", "001_x.sql"), new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    const [r] = await migrations([dir]);
    expect(r.items.map((i) => i.name)).toEqual(["20260301_AddUsers.cs", "001_x.sql", "20260101_Init.cs"]);
  });

  it("leaves out repos with no migrations", async () => {
    expect(await migrations([dir])).toEqual([]);
  });
});

const sess = (id: string, status: Session["status"], extra: Partial<Session> = {}): Session => ({
  id, project: `p-${id}`, cwd: `/r/${id}`, lastActivity: "2026-11-13T10:00:00Z", status, district: "home",
  tokens: {} as Session["tokens"], employees: [], ...extra,
});
const op = (command: string, text: string, isError = false, at = "2026-11-13T10:00:00Z"): Op => ({ at, name: "Bash", input: { command }, text, isError, ms: 500 });

function deps(over: Partial<Deps> = {}): Deps {
  return {
    sessions: () => [sess("a", "waiting", { title: "Fix login", lastActivity: "2026-11-13T09:00:00Z" }), sess("b", "idle", { lastActivity: "2026-11-13T08:00:00Z" }), sess("c", "idle", { lastActivity: "2026-11-13T10:00:00Z" }), sess("d", "working")],
    ops: async (id) => (id === "a" ? [op("npm test", "Tests  3 passed (3)"), op("npm run build", "ok"), op("git push", "done")] : []),
    said: async (id) => `question from ${id}`,
    exec: exec({}),
    ...over,
  };
}

describe("buildingData", () => {
  it("townhall: the sessions waiting for you, with what Claude last said", async () => {
    expect(await buildingData("townhall", deps())).toEqual({
      id: "townhall",
      items: [{ id: "a", project: "p-a", title: "Fix login", said: "question from a", at: "2026-11-13T09:00:00Z" }],
    });
  });

  it("home: the idle sessions, the most recently active first", async () => {
    const d = await buildingData("home", deps());
    expect(d).toMatchObject({ id: "home", items: [{ id: "c" }, { id: "b" }] });
  });

  it("lab, factory and airport read the sessions' commands", async () => {
    const lab = await buildingData("lab", deps());
    expect(lab).toMatchObject({ id: "lab", runs: [{ command: "npm test", ok: true, project: "p-a" }] });
    expect(await buildingData("factory", deps())).toMatchObject({ id: "factory", runs: [{ command: "npm run build" }] });
    const air = await buildingData("airport", deps({ exec: exec({ "git rev-parse --show-toplevel": "/r/a\n", "gh run list --limit 8 --json name,conclusion,status,headBranch,createdAt,url": "[]" }) }));
    expect(air).toMatchObject({ id: "airport", flights: [{ command: "git push" }], ci: [{ repo: "a", runs: [] }] });
  });

  it("site: the repos' changes", async () => {
    const d = await buildingData("site", deps({ exec: exec({ "git rev-parse --show-toplevel": "/r/a\n", "git status --porcelain=v1 -z": " M x.ts\0", "git diff --numstat HEAD": "1\t2\tx.ts\n" }) }));
    expect(d).toMatchObject({ id: "site", repos: [{ repo: "a", files: [{ path: "x.ts", add: 1, del: 2 }] }] });
  });

  it("a source that fails leaves its board empty instead of failing", async () => {
    const d = await buildingData("lab", deps({ ops: async () => { throw new Error("gone"); } }));
    expect(d).toEqual({ id: "lab", runs: [] });
  });
});

describe("buildingCache", () => {
  it("reuses a board for the ttl, unless asked for a fresh one", async () => {
    let t = 0;
    const said = vi.fn(async () => "x");
    const get = buildingCache(deps({ said }), 1000, () => t);
    await get("townhall");
    await get("townhall");
    expect(said).toHaveBeenCalledTimes(1);
    await get("townhall", true);
    expect(said).toHaveBeenCalledTimes(2);
    t = 5000;
    await get("townhall");
    expect(said).toHaveBeenCalledTimes(3);
  });
});
