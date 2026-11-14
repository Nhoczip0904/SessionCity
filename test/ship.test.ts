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
