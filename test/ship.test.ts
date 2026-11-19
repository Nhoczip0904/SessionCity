// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { shipKind } from "../src/server/ship.js";
import { Store } from "../src/server/store.js";
import { Ships, flyPlane } from "../src/client/ship.js";

describe("shipKind", () => {
  it("spots push and PR commands only in Bash", () => {
    expect(shipKind("Bash", { command: "git push origin main" })).toBe("push");
    expect(shipKind("Bash", { command: "git add . && git -C x push -u origin b" })).toBe("push");
    expect(shipKind("Bash", { command: "gh pr create --title x" })).toBe("pr");
    expect(shipKind("Bash", { command: "cat > /tmp/b.md <<'EOF'\nbody\nEOF\ngh pr create --base dev" })).toBe("pr"); // on a line of its own
    expect(shipKind("Bash", { command: "git push -u origin x 2>&1 | tail -2\ngit push" })).toBe("push");
    expect(shipKind("Bash", { command: "git pull" })).toBeNull();
    expect(shipKind("Bash", { command: "echo git pushing" })).toBeNull();
    expect(shipKind("Read", { command: "git push" })).toBeNull();
    expect(shipKind("Bash", null)).toBeNull();
  });
});

describe("Store ships", () => {
  it("counts pushes and PRs per session", () => {
    const s = new Store();
    const ev = (command: string) => ({ kind: "tool", sessionId: "s1", at: "2026-11-09T10:00:00.000Z", name: "Bash", input: { command }, district: "airport" }) as never;
    s.apply(ev("git push")); s.apply(ev("gh pr create")); s.apply(ev("git push"));
    expect(s.snapshot().sessions[0].ships).toEqual({ push: 2, pr: 1 });
  });
});

describe("Store session PRs", () => {
  const at = "2026-11-09T10:00:00.000Z";
  const call = (toolUseId: string, command: string) => ({ kind: "tool", sessionId: "s1", at, name: "Bash", input: { command }, district: "airport", toolUseId }) as never;
  const result = (toolUseId: string, text: string) => ({ kind: "report", sessionId: "s1", at, toolUseId, text }) as never;
  it("keeps the PR links that `gh pr create` printed, once each; other commands' links are ignored", () => {
    const s = new Store();
    s.apply(call("a", "gh pr create --title x"));
    s.apply(result("a", "Creating pull request\nhttps://github.com/o/r/pull/12\n"));
    s.apply(result("a", "https://github.com/o/r/pull/12")); // same link again
    s.apply(call("b", "gh pr list"));
    s.apply(result("b", "https://github.com/o/r/pull/99"));
    s.apply(call("c", "gh pr create"));
    s.apply(result("c", "https://evil.example/o/r/pull/5 and https://github.com/o/r/pull/13/files"));
    expect(s.snapshot().sessions[0].prs).toEqual(["https://github.com/o/r/pull/12", "https://github.com/o/r/pull/13"]);
  });
  it("a PR a subagent opened counts for the session's prs (but not for its ship counter)", () => {
    const s = new Store();
    s.apply({ ...(call("a", "gh pr create --fill") as object), agentId: "ag1" } as never);
    s.apply(result("a", "https://github.com/o/r/pull/21"));
    const x = s.snapshot().sessions[0];
    expect(x.prs).toEqual(["https://github.com/o/r/pull/21"]);
    expect(x.ships?.pr ?? 0).toBe(0);
  });
  it("a session that opened no PR has no prs", () => {
    const s = new Store();
    s.apply(call("a", "git push"));
    expect(s.snapshot().sessions[0].prs).toBeUndefined();
  });
});

describe("Ships", () => {
  const s = (id: string, push = 0, pr = 0) => ({ id, ships: { push, pr } }) as never;
  it("ignores the first look and new sessions, reports increases", () => {
    const d = new Ships();
    expect(d.update([s("a", 3)])).toEqual([]);
    expect(d.update([s("a", 4, 1), s("b", 9)])).toEqual([{ id: "a", kind: "push" }, { id: "a", kind: "pr" }]);
    expect(d.update([s("a", 4, 1), s("b", 9)])).toEqual([]);
  });
});

describe("flyPlane", () => {
  it("adds a plane and does not throw", () => {
    const p = new Container();
    flyPlane(p, { x: 0, y: 50 }, "push");
    expect(p.children.length).toBe(1);
  });
});
