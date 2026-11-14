// @vitest-environment happy-dom
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mainRepo } from "../src/server/worktree.js";
import { Store } from "../src/server/store.js";
import { grouped } from "../src/client/agentList.js";
import type { Session } from "../src/shared/types.js";

const root = mkdtempSync(join(tmpdir(), "wt-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const dir = (...p: string[]) => (mkdirSync(join(root, ...p), { recursive: true }), join(root, ...p));

describe("mainRepo", () => {
  it("finds the repo a worktree belongs to", () => {
    const repo = dir("AgriTA");
    dir("AgriTA", ".git", "worktrees", "feat-x");
    const wt = dir("feat-x");
    writeFileSync(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "feat-x").split(sep).join("/")}\n`);
    expect(mainRepo(wt)).toBe(repo);
  });
  it("an ordinary repo, a plain folder, a submodule and a missing folder are not worktrees", () => {
    expect(mainRepo(dir("plain"))).toBeNull();
    expect(mainRepo(dir("normal", ".git") && join(root, "normal"))).toBeNull();
    const sub = dir("sub");
    writeFileSync(join(sub, ".git"), "gitdir: ../outer/.git/modules/sub\n");
    expect(mainRepo(sub)).toBeNull();
    expect(mainRepo(join(root, "nope"))).toBeNull();
    const junk = dir("junk");
    writeFileSync(join(junk, ".git"), "not a pointer");
    expect(mainRepo(junk)).toBeNull();
  });
});

describe("Store names a worktree session after its repo", () => {
  const meta = (cwd: string) => ({ kind: "meta" as const, sessionId: "s1", at: "2026-01-01T00:00:00Z", cwd });
  it("project is the repo's name; repo and worktree are filled; an ordinary folder has neither", () => {
    const st = new Store(Date.now, (c) => (c.endsWith("feat-x") ? "D:/code/AgriTA" : null));
    st.apply(meta("D:/code/feat-x"));
    let s = st.snapshot().sessions[0]!;
    expect([s.project, s.repo, s.worktree]).toEqual(["AgriTA", "D:/code/AgriTA", "feat-x"]);
    st.apply({ ...meta("D:/code/other"), sessionId: "s2" });
    s = st.snapshot().sessions.find((x) => x.id === "s2")!;
    expect([s.project, s.repo, s.worktree]).toEqual(["other", undefined, undefined]);
  });
  it("asks the disk once per folder", () => {
    let n = 0;
    const st = new Store(Date.now, () => (n++, null));
    st.apply(meta("D:/x"));
    st.apply(meta("D:/x"));
    st.apply({ ...meta("D:/x"), sessionId: "s2" });
    expect(n).toBe(1);
  });
});

describe("grouped", () => {
  const s = (id: string, status: Session["status"], at: string, repo?: string): Session =>
    ({ id, project: id, cwd: `/${id}`, repo, worktree: repo ? id : undefined, status, lastActivity: at }) as Session;
  it("keeps a repo's worktrees together; the repo with the most urgent session leads", () => {
    const out = grouped([
      s("a", "idle", "2026-01-03T00:00:00Z"),
      s("w1", "idle", "2026-01-02T00:00:00Z", "/r"),
      s("b", "working", "2026-01-01T00:00:00Z"),
      s("w2", "working", "2026-01-01T00:00:00Z", "/r"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["w2", "w1", "b", "a"]);
  });
});
