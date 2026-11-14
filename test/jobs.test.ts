// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { JobQueue, MAX_WORKING } from "../src/client/queue.js";
import { TEMPLATES, renderLaunchDialog } from "../src/client/launcher.js";
import { fixPrompt, renderBuilding, type BuildingCtx } from "../src/client/buildings.js";
import type { CmdRun, Session } from "../src/shared/types.js";

const working = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, status: "working" }) as Session);
const disk = (v: string | null = null) => {
  const d = { v, get: () => d.v, set: (x: string) => void (d.v = x) };
  return d;
};

describe("JobQueue", () => {
  it("starts jobs in order while fewer than 3 sessions are working", () => {
    let t = 0;
    const q = new JobQueue(disk(), () => t);
    q.add({ cwd: "/a" });
    q.add({ cwd: "/b" });
    expect(q.take(working(MAX_WORKING))).toBeUndefined(); // all places taken
    expect(q.take(working(2))).toEqual({ cwd: "/a" });
    expect(q.size).toBe(1);
    expect(q.take(working(0))).toBeUndefined(); // the last one just started: give it time to appear
    t += 20_000;
    expect(q.take(working(0))).toEqual({ cwd: "/b" });
    expect(q.take(working(0))).toBeUndefined();
  });
  it("only working sessions use up a place", () => {
    const q = new JobQueue(disk(), () => 0);
    q.add({ cwd: "/a" });
    const idle = [{ status: "idle" }, { status: "waiting" }, { status: "idle" }, { status: "waiting" }] as Session[];
    expect(q.take(idle)).toEqual({ cwd: "/a" });
  });
  it("survives a reload, and a damaged list is just empty", () => {
    const d = disk();
    new JobQueue(d).add({ cwd: "/a", prompt: "x" });
    expect(new JobQueue(d).size).toBe(1);
    expect(new JobQueue(disk("{not json")).size).toBe(0);
    expect(new JobQueue(disk('[1,{"cwd":"/ok"},{"x":1}]')).size).toBe(1);
  });
  it("refuses jobs past 50 without losing the rest", () => {
    const q = new JobQueue(disk());
    for (let i = 0; i < 60; i++) q.add({ cwd: `/${i}` });
    expect(q.size).toBe(50);
  });
});

describe("launch dialog: templates, preset prompt, queue", () => {
  const q = <T extends Element>(d: Element, s: string) => d.querySelector<T>(s)!;
  it("picking a template fills the request box; the first choice leaves it alone", () => {
    const d = renderLaunchDialog(["/a"], async () => null);
    const tpl = q<HTMLSelectElement>(d, "select.tpl");
    const box = q<HTMLTextAreaElement>(d, "textarea");
    tpl.value = TEMPLATES[1]![1];
    tpl.dispatchEvent(new Event("change"));
    expect(box.value).toBe(TEMPLATES[1]![1]);
    box.value = "việc của tôi";
    tpl.value = "";
    tpl.dispatchEvent(new Event("change"));
    expect(box.value).toBe("việc của tôi");
  });
  it("a preset prompt is put in the box and sent with Mở", () => {
    const onSubmit = vi.fn(async () => null);
    const d = renderLaunchDialog(["/a"], onSubmit, "/a", "sửa giúp");
    q<HTMLButtonElement>(d, "button.go").click();
    expect(onSubmit).toHaveBeenCalledWith({ cwd: "/a", prompt: "sửa giúp" });
  });
  it("Xếp hàng exists only with a queue, hands over the same options and does not open anything", () => {
    const onSubmit = vi.fn(async () => null);
    expect([...renderLaunchDialog(["/a"], onSubmit).querySelectorAll("button")].some((b) => b.textContent === "Xếp hàng")).toBe(false);
    const onQueue = vi.fn(() => 2);
    const d = renderLaunchDialog(["/a"], onSubmit, undefined, undefined, onQueue);
    q<HTMLSelectElement>(d, "select.model").value = "opus";
    q<HTMLTextAreaElement>(d, "textarea").value = "làm đi";
    [...d.querySelectorAll("button")].find((b) => b.textContent === "Xếp hàng")!.click();
    expect(onQueue).toHaveBeenCalledWith({ cwd: "/a", model: "opus", prompt: "làm đi" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(q(d, ".msg").textContent).toBe("Đã xếp hàng — 2 việc đang chờ");
    expect(q<HTMLTextAreaElement>(d, "textarea").value).toBe("");
  });
});

describe("Giao agent sửa", () => {
  const run = (o: Partial<CmdRun> = {}): CmdRun => ({ at: "2026-01-01T00:00:00Z", project: "proj", command: "npm test", ok: false, ms: 1000, note: "2 failed", ...o });
  const ctx = (fix?: BuildingCtx["fix"]): BuildingCtx => ({ avatarOf: () => null, chat: () => {}, now: () => Date.parse("2026-01-01T00:01:00Z"), fix });
  const fixBtn = (el: HTMLElement) => [...el.querySelectorAll("button")].find((b) => b.textContent === "Giao agent sửa");

  it("the lab, the factory and the airport offer it for the latest failure", () => {
    const f = vi.fn();
    const lab = renderBuilding({ id: "lab", runs: [run({ ok: true }), run({ note: "boom" })] }, ctx(f));
    fixBtn(lab)!.click();
    expect(f).toHaveBeenCalledWith(expect.objectContaining({ note: "boom" }));
    expect(fixBtn(renderBuilding({ id: "factory", runs: [run()] }, ctx(f)))).toBeTruthy();
    expect(fixBtn(renderBuilding({ id: "airport", flights: [run({ command: "git push" })], ci: [] }, ctx(f)))).toBeTruthy();
  });
  it("no button when everything passed, or when the page cannot launch", () => {
    expect(fixBtn(renderBuilding({ id: "lab", runs: [run({ ok: true })] }, ctx(vi.fn())))).toBeUndefined();
    expect(fixBtn(renderBuilding({ id: "lab", runs: [run()] }, ctx()))).toBeUndefined();
    expect(fixBtn(renderBuilding({ id: "lab", runs: [run({ ok: null })] }, ctx(vi.fn())))).toBeUndefined();
  });
  it("the request names the project, the command and the result; control characters go", () => {
    const p = fixPrompt(run({ command: "npm test\u0007 -- x", note: "a\u0000b" }));
    expect(p).toContain("proj");
    expect(p).toContain("npm test  -- x");
    expect(p).toContain("Kết quả: a b");
    // eslint-disable-next-line no-control-regex
    expect(p).not.toMatch(/[\u0000-\u0008]/);
    expect(fixPrompt(run({ command: "x".repeat(9000) })).length).toBe(4000);
  });
});

describe("summary of the day", () => {
  const sess = (id: string, status: Session["status"], at: string, output = 0, title?: string): Session =>
    ({ id, project: id, title, cwd: "", lastActivity: at, status, district: "lab", tokens: { input: 0, output, cacheRead: 0, cacheWrite: 0, byModel: {} }, employees: [] }) as Session;
  const now = Date.parse("2026-11-14T12:00:00");
  it("counts only today's sessions, newest first, with their output", async () => {
    const { summarize } = await import("../src/client/summary.js");
    const s = summarize([sess("old", "idle", "2026-11-10T09:00:00"), sess("a", "working", "2026-11-14T09:00:00", 100), sess("b", "waiting", "2026-11-14T11:00:00", 50), sess("c", "idle", "2026-11-14T10:00:00")], now, null);
    expect(s.today.map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect([s.working, s.waiting, s.idle, s.output, s.prs]).toEqual([1, 1, 1, 150, null]);
  });
  it("counts open PRs and the ones whose CI failed", async () => {
    const { summarize } = await import("../src/client/summary.js");
    const pr = (ci: "pass" | "fail" | null) => ({ number: 1, title: "t", url: null, author: null, draft: false, review: null, ci });
    const s = summarize([], now, [{ repo: "r", prs: [pr("fail"), pr("pass"), pr(null)] }, { repo: "q", prs: [], error: "x" }]);
    expect(s.prs).toEqual({ open: 3, failing: 1 });
  });
  it("lists unfinished work before finished, opens a session on click, and shows an empty day", async () => {
    const { summarize, renderSummary } = await import("../src/client/summary.js");
    const open = vi.fn();
    const ctx = { avatarOf: () => null, now: () => now, queued: 2, open };
    const el = renderSummary(summarize([sess("a", "idle", "2026-11-14T09:00:00"), sess("b", "waiting", "2026-11-14T08:00:00", 0, "Sửa <b>lỗi</b>")], now, null), ctx);
    expect(el.querySelectorAll("h3")[0]!.textContent).toBe("Còn dang dở");
    expect(el.querySelectorAll("h3")[1]!.textContent).toBe("Đã xong lượt");
    expect(el.textContent).toContain("2 việc đang xếp hàng");
    expect(el.querySelector("b")).toBeNull(); // titles are text
    el.querySelector<HTMLButtonElement>(".sum-row")!.click();
    expect(open).toHaveBeenCalledWith("b");
    expect(renderSummary(summarize([], now, null), { ...ctx, queued: 0 }).textContent).toContain("chưa có phiên nào");
  });
});
