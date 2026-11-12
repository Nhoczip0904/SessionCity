// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Employee, Session } from "../src/shared/types.js";
import { AgentList } from "../src/client/agentList.js";

const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byModel: {} };
const session = (id: string, status: Session["status"], lastActivity: string, extra: Partial<Session> = {}): Session => ({
  id, project: `proj-${id}`, cwd: "/x", lastActivity, status, district: "townhall", tokens, employees: [], ...extra,
});
const employee = (id: string, sessionId: string, status: Employee["status"]): Employee => ({
  id, sessionId, type: "Explore", description: `find ${id}`, prompt: "", toolUseId: `t-${id}`, status, district: "library", startedAt: "2026-01-01T00:00:00Z", tokens,
});

const SESSIONS = [
  session("a", "idle", "2026-01-01T05:00:00Z"),
  session("b", "working", "2026-01-01T01:00:00Z", { title: "Fix the login" }),
  session("c", "waiting", "2026-01-01T02:00:00Z"),
  session("d", "working", "2026-01-01T03:00:00Z"),
];
const EMPLOYEES = [employee("e1", "b", "working"), employee("e2", "b", "done"), employee("e3", "a", "done")];

const setup = () => {
  const root = document.createElement("nav");
  const pick = vi.fn();
  const list = new AgentList(root, pick);
  list.render(SESSIONS, EMPLOYEES);
  const rows = () => [...root.querySelectorAll<HTMLElement>(".agent-row")].map((r) => r.textContent!.trim());
  const toggle = (id: string) => root.querySelector<HTMLButtonElement>(`[data-toggle="${id}"]`)!;
  return { root, pick, list, rows, toggle };
};

describe("the agent index on the left", () => {
  it("lists main agents only: working first, then waiting, then idle, newest first within each", () => {
    const { rows } = setup();
    expect(rows()).toEqual(["proj-d", "Fix the login", "proj-c", "proj-a"]);
  });

  it("a + with the subagent count shows them; pressing again hides them", () => {
    const { rows, toggle } = setup();
    expect(toggle("b").textContent).toBe("+2");
    expect(toggle("b").getAttribute("aria-expanded")).toBe("false");
    expect(toggle("c")).toBeNull(); // no subagents, no button
    toggle("b").click();
    expect(toggle("b").textContent).toBe("−");
    expect(toggle("b").closest("li")!.className).toBe("open");
    expect(toggle("b").getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toEqual(["proj-d", "Fix the login", "Explore — find e1", "Explore — find e2", "proj-c", "proj-a"]);
    toggle("b").click();
    expect(rows()).toEqual(["proj-d", "Fix the login", "proj-c", "proj-a"]);
  });

  it("an opened agent stays open when the data refreshes", () => {
    const { list, rows, toggle } = setup();
    toggle("a").click();
    list.render(SESSIONS, EMPLOYEES);
    expect(rows()).toContain("Explore — find e3");
  });

  it("keyboard focus stays on the same row when the data refreshes", () => {
    const { root, list, toggle } = setup();
    document.body.append(root);
    toggle("b").focus();
    list.render(SESSIONS, EMPLOYEES);
    expect(document.activeElement).toBe(toggle("b"));
    root.querySelector<HTMLElement>('[data-pick="session:c"]')!.focus();
    list.render(SESSIONS, EMPLOYEES);
    expect((document.activeElement as HTMLElement).dataset.pick).toBe("session:c");
    root.remove();
  });

  it("clicking a row opens that agent or subagent", () => {
    const { root, pick, toggle } = setup();
    root.querySelector<HTMLElement>('[data-pick="session:c"]')!.click();
    expect(pick).toHaveBeenLastCalledWith("session", "c");
    toggle("b").click();
    root.querySelector<HTMLElement>('[data-pick="employee:e2"]')!.click();
    expect(pick).toHaveBeenLastCalledWith("employee", "e2");
  });

  it("main agents show their avatar left of the name; subagents and agents without one do not", () => {
    const root = document.createElement("nav");
    const list = new AgentList(root, vi.fn(), (id) => (id === "b" ? "data:image/png;base64,AAA" : null));
    list.render(SESSIONS, EMPLOYEES);
    root.querySelector<HTMLButtonElement>('[data-toggle="b"]')!.click();
    const img = root.querySelector<HTMLImageElement>('[data-pick="session:b"] img')!;
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(img.alt).toBe("");
    expect(img.nextElementSibling!.textContent).toBe("Fix the login");
    expect(root.querySelector('[data-pick="session:c"] img')).toBeNull();
    expect(root.querySelector('[data-pick="employee:e1"] img')).toBeNull();
  });

  it("text from the data is shown as text, not markup", () => {
    const root = document.createElement("nav");
    new AgentList(root, vi.fn()).render([session("x", "idle", "2026-01-01T00:00:00Z", { title: "<img src=x onerror=alert(1)>" })], []);
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
