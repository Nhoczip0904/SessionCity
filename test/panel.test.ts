// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Panel, renderEmployee, renderSession } from "../src/client/panel.js";
import type { Delta, Employee, EmployeeDetail, SessionDetail, Tokens } from "../src/shared/types.js";

const tokens: Tokens = { input: 1200, output: 30, cacheRead: 5, cacheWrite: 7, byModel: { "m-1": { input: 1200, output: 30, cacheRead: 5, cacheWrite: 7 } } };
const NOW = Date.parse("2026-01-01T00:10:00Z");
const emp = (id: string, status: Employee["status"]): Employee => ({
  id, sessionId: "s1", type: "Explore", description: `d-${id}`, prompt: "p", toolUseId: "t", status, district: "library",
  startedAt: "2026-01-01T00:00:00Z", tokens,
});
const session = (over: Partial<SessionDetail> = {}): SessionDetail => ({
  id: "s1", project: "proj", cwd: "/x", branch: "main", model: "m-1", lastActivity: "2026-01-01T00:08:00Z", status: "working",
  district: "site", tokens, employees: [], lastPrompt: "hello", steps: [], staff: [], ...over,
});
const employee = (over: Partial<EmployeeDetail> = {}): EmployeeDetail => ({ ...emp("e1", "working"), models: ["m-1"], steps: [], ...over });
const step = (i: number) => ({ at: "2026-01-01T00:09:00Z", name: "Read", summary: `step-${i};`, district: "library" as const });

describe("renderSession", () => {
  it("prompt with <script> renders as text", () => {
    const el = renderSession(session({ lastPrompt: "<script>alert(1)</script>" }), NOW, () => {});
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("<script>");
  });
  it("project name with <img onerror> renders as text", () => {
    const el = renderSession(session({ project: "<img src=x onerror=alert(1)>" }), NOW, () => {});
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img");
  });
  it("shows relative time and status badge", () => {
    const el = renderSession(session(), NOW, () => {});
    expect(el.textContent).toContain("2 phút trước");
    expect(el.textContent).toContain("Đang làm");
  });
  it("session lists working staff before done", () => {
    const staff = [emp("done1", "done"), emp("work1", "working")];
    const el = renderSession(session({ staff }), NOW, () => {});
    const t = el.textContent!;
    expect(t.indexOf("d-work1")).toBeGreaterThan(-1);
    expect(t.indexOf("d-work1")).toBeLessThan(t.indexOf("d-done1"));
  });
  it("clicking a staff row picks the employee", () => {
    const pick = vi.fn();
    const el = renderSession(session({ staff: [emp("work1", "working")] }), NOW, pick);
    (el.querySelector("[data-employee]") as HTMLElement).click();
    expect(pick).toHaveBeenCalledWith("work1");
  });
  it("shows only the 20 newest steps; step row has overflow-wrap:anywhere", () => {
    const steps = Array.from({ length: 30 }, (_, i) => step(i));
    const el = renderSession(session({ steps }), NOW, () => {});
    const rows = el.querySelectorAll(".step");
    expect(rows.length).toBe(20);
    expect((rows[0] as HTMLElement).style.overflowWrap).toBe("anywhere");
    expect(el.textContent).toContain("step-29;");
    expect(el.textContent).toContain("step-10;");
    expect(el.textContent).not.toContain("step-9;");
  });
});

describe("renderEmployee", () => {
  it("truncated prompt shows the rút gọn note", () => {
    const el = renderEmployee(employee({ prompt: "abc…" }), NOW, () => {});
    expect(el.textContent).toContain("(đã rút gọn — xem đầy đủ trong transcript)");
  });
  it("complete prompt and report have no note", () => {
    const el = renderEmployee(employee({ prompt: "abc", report: "done" }), NOW, () => {});
    expect(el.textContent).not.toContain("rút gọn");
    expect(el.textContent).toContain("done");
  });
  it("employee without report shows Đang làm…", () => {
    const el = renderEmployee(employee(), NOW, () => {});
    expect(el.textContent).toContain("Đang làm…");
  });
  it("prompt is in a <pre> as text; back button works", () => {
    const back = vi.fn();
    const el = renderEmployee(employee({ prompt: "<b>x</b>" }), NOW, back);
    expect(el.querySelector("pre")!.textContent).toBe("<b>x</b>");
    expect(el.querySelector("b")).toBeNull();
    (el.querySelector("button") as HTMLElement).click();
    expect(back).toHaveBeenCalled();
  });
  it("renders at most 100 steps", () => {
    const steps = Array.from({ length: 120 }, (_, i) => step(i));
    expect(renderEmployee(employee({ steps }), NOW, () => {}).querySelectorAll(".step").length).toBe(100);
  });
});

describe("Panel", () => {
  const delta = (id: string): Delta => ({ sessions: [{ ...session(), id } as never], employees: [], removed: [] });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("Panel shows ended banner on gone and keeps content", async () => {
    const root = document.createElement("div");
    const fetchDetail = vi.fn().mockResolvedValueOnce(session({ project: "keepme" })).mockResolvedValueOnce("gone");
    const p = new Panel(root, fetchDetail);
    await p.open("session", "s1");
    expect(root.textContent).toContain("keepme");
    p.onDelta(delta("s1"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(root.textContent).toContain("Phiên này đã kết thúc");
    expect(root.textContent).toContain("keepme");
  });
  it("employee gone banner wording", async () => {
    const root = document.createElement("div");
    const p = new Panel(root, vi.fn().mockResolvedValue("gone"));
    await p.open("employee", "e1");
    expect(root.textContent).toContain("Nhân viên này đã kết thúc");
  });
  it("network error keeps content silently", async () => {
    const root = document.createElement("div");
    const fetchDetail = vi.fn().mockResolvedValueOnce(session({ project: "keepme" })).mockRejectedValueOnce(new Error("net"));
    const p = new Panel(root, fetchDetail);
    await p.open("session", "s1");
    p.onDelta(delta("s1"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(root.textContent).toContain("keepme");
    expect(root.textContent).not.toContain("kết thúc");
  });
  it("Panel refetches once per second at most on matching deltas", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(session());
    const p = new Panel(document.createElement("div"), fetchDetail);
    await p.open("session", "s1");
    await vi.advanceTimersByTimeAsync(1000);
    fetchDetail.mockClear();
    p.onDelta(delta("s1"));
    await vi.advanceTimersByTimeAsync(100);
    p.onDelta(delta("s1"));
    await vi.advanceTimersByTimeAsync(100);
    p.onDelta(delta("s1"));
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchDetail).toHaveBeenCalledTimes(1); // 3 deltas in 200 ms → 1 fetch
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchDetail).toHaveBeenCalledTimes(2); // trailing refetch, 1 s after the first
  });
  it("ignores deltas for other ids and when closed", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(session());
    const p = new Panel(document.createElement("div"), fetchDetail);
    p.onDelta(delta("s1"));
    await p.open("session", "s1");
    fetchDetail.mockClear();
    p.onDelta(delta("other"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchDetail).not.toHaveBeenCalled();
  });
  it("Esc and close button close; opening an employee from the list replaces content", async () => {
    const root = document.createElement("div");
    const fetchDetail = vi.fn(async (kind: string) => (kind === "session" ? session({ staff: [emp("w1", "working")] }) : employee({ id: "w1" })));
    const p = new Panel(root, fetchDetail as never);
    await p.open("session", "s1");
    expect(root.hidden).toBe(false);
    (root.querySelector("[data-employee]") as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toContain("Thị trưởng giao việc");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.hidden).toBe(true);
    await p.open("session", "s1");
    (root.querySelector(".close") as HTMLElement).click();
    expect(root.hidden).toBe(true);
  });
});
