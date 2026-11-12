// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Panel, renderEmployee, renderSession } from "../src/client/panel.js";
import type { ChatLine, Delta, Employee, EmployeeDetail, SessionDetail, Tokens } from "../src/shared/types.js";

const tokens: Tokens = { input: 1200, output: 30, cacheRead: 5, cacheWrite: 7, byModel: { "m-1": { input: 1200, output: 30, cacheRead: 5, cacheWrite: 7 } } };
const NOW = Date.parse("2026-01-01T00:10:00Z");
const emp = (id: string, status: Employee["status"]): Employee => ({
  id, sessionId: "s1", type: "Explore", description: `d-${id}`, prompt: "p", toolUseId: "t", status, district: "library",
  startedAt: "2026-01-01T00:00:00Z", tokens,
});
const session = (over: Partial<SessionDetail> = {}): SessionDetail => ({
  id: "s1", project: "proj", cwd: "/x", branch: "main", model: "m-1", lastActivity: "2026-01-01T00:08:00Z", status: "working",
  district: "site", tokens, employees: [], lastPrompt: "hello", steps: [], staff: [], chat: [], ...over,
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
  it("mini chat replaces the step list: oldest at the top, newest at the bottom, who said it on each line", () => {
    const chat: ChatLine[] = [
      { at: "2026-01-01T00:09:00Z", role: "claude", text: "done it" },
      { at: "2026-01-01T00:08:00Z", role: "user", text: "do it" },
    ];
    const el = renderSession(session({ chat, steps: [step(1)] }), NOW, () => {});
    expect(el.textContent).toContain("Trò chuyện");
    expect(el.textContent).not.toContain("Hoạt động gần đây");
    expect(el.querySelectorAll(".step")).toHaveLength(0);
    const rows = [...el.querySelectorAll(".chat-line")];
    expect(rows.map((r) => r.className)).toEqual(["chat-line user", "chat-line claude"]);
    expect(rows[0].textContent).toContain("Bạn");
    expect(rows[0].textContent).toContain("do it");
    expect(rows[1].textContent).toContain("Claude");
    expect(rows[1].textContent).toContain("done it");
    expect(renderSession(session(), NOW, () => {}).querySelector(".chat")!.textContent).toBe("—");
  });
  it("truncated lastPrompt shows the rút gọn note", () => {
    const el = renderSession(session({ lastPrompt: "abc…" }), NOW, () => {});
    expect(el.querySelector("details")!.textContent).toContain("(đã rút gọn — xem đầy đủ trong transcript)");
    expect(renderSession(session({ lastPrompt: "abc" }), NOW, () => {}).textContent).not.toContain("rút gọn");
  });
  it("chat line with empty or unparseable at shows — not Invalid", () => {
    const el = renderSession(session({ chat: [{ at: "", role: "user", text: "a" }, { at: "garbage", role: "claude", text: "b" }] }), NOW, () => {});
    expect(el.textContent).not.toContain("Invalid");
    expect(el.textContent).toContain("—");
  });
  it("<img onerror> in step summary, report and model name stays text", () => {
    const x = "<img src=x onerror=alert(1)>";
    const s = renderSession(session({ chat: [{ at: "", role: "claude", text: x }], tokens: { ...tokens, byModel: { [x]: tokens } } }), NOW, () => {});
    const e = renderEmployee(employee({ report: x, models: [x], steps: [{ ...step(1), summary: x }] }), NOW, () => {});
    for (const el of [s, e]) {
      expect(el.querySelector("img")).toBeNull();
      expect(el.textContent).toContain(x);
    }
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
  it("renders the 100 newest steps (input newest-first)", () => {
    const steps = Array.from({ length: 120 }, (_, i) => step(119 - i));
    const rows = renderEmployee(employee({ steps }), NOW, () => {}).querySelectorAll(".step");
    expect(rows.length).toBe(100);
    expect(rows[0].textContent).toContain("step-119;");
    expect(rows[99].textContent).toContain("step-20;");
  });
});

describe("Panel", () => {
  const delta = (id: string): Delta => ({ sessions: [{ ...session(), id } as never], employees: [], removed: [] });
  let added: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    added = vi.spyOn(document, "addEventListener");
  });
  afterEach(() => {
    // panels from earlier tests must not swallow Esc in later ones
    for (const [t, l] of added.mock.calls) if (t === "keydown") document.removeEventListener(t, l as EventListener);
    added.mockRestore();
    vi.useRealTimers();
  });

  it("session panel has an Open in Claude Desktop button; the result shows and outlives a redraw", async () => {
    const root = document.createElement("div");
    const fetchDetail = vi.fn().mockResolvedValue(session({ id: "s1" }));
    const openDesktop = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("Không mở được Claude Desktop");
    const p = new Panel(root, fetchDetail, openDesktop);
    await p.open("session", "s1");
    const btn = () => root.querySelector("button.desktop") as HTMLButtonElement;
    expect(btn().textContent).toContain("Mở trong Claude Desktop");
    btn().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(openDesktop).toHaveBeenCalledWith("s1");
    expect(root.textContent).toContain("Đã mở trong Claude Desktop");
    p.onDelta(delta("s1"));
    await vi.advanceTimersByTimeAsync(1000); // body redrawn
    expect(root.textContent).toContain("Đã mở trong Claude Desktop");
    btn().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toContain("Không mở được Claude Desktop");
  });
  it("no Desktop button for an employee, or without an opener", async () => {
    const root = document.createElement("div");
    const p = new Panel(root, vi.fn().mockResolvedValue(employee()), vi.fn());
    await p.open("employee", "e1");
    expect(root.querySelector("button.desktop")).toBeNull();
    expect(renderSession(session(), NOW, () => {}).querySelector("button.desktop")).toBeNull();
  });

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
  it("Esc on a closed panel does not stop propagation", () => {
    new Panel(document.createElement("div"), vi.fn());
    const later = vi.fn();
    document.addEventListener("keydown", later);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.removeEventListener("keydown", later);
    expect(later).toHaveBeenCalledTimes(1);
  });
  it("collapsed prompt stays collapsed across refresh; a newly opened actor starts open", async () => {
    const root = document.createElement("div");
    const p = new Panel(root, vi.fn().mockResolvedValue(session()));
    await p.open("session", "s1");
    root.querySelector("details")!.open = false;
    p.onDelta(delta("s1"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(root.querySelector("details")!.open).toBe(false);
    await p.open("session", "s2");
    expect(root.querySelector("details")!.open).toBe(true);
  });
  it("open() cancels a pending trailing refetch", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(session());
    const p = new Panel(document.createElement("div"), fetchDetail);
    await p.open("session", "s1");
    p.onDelta(delta("s1")); // schedules a refetch ~1 s after the open fetch
    await vi.advanceTimersByTimeAsync(500);
    await p.open("session", "s2");
    fetchDetail.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchDetail).not.toHaveBeenCalled();
  });
});
