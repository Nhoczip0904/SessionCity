// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapsed, jobStrip } from "../src/client/chatJobs.js";

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

describe("elapsed", () => {
  it("formats seconds and minutes", () => {
    expect(elapsed(5_000)).toBe("5s");
    expect(elapsed(130_000)).toBe("2m10s");
  });
});

const titles = (s: { el: HTMLElement }) => [...s.el.querySelectorAll<HTMLElement>(".tube")].map((t) => t.title).join("|");

describe("jobStrip", () => {
  it("is hidden with no jobs", () => {
    const s = jobStrip();
    s.set([]);
    expect(s.el.hidden).toBe(true);
  });

  it("shows a running job with its time, and ticks", () => {
    const s = jobStrip();
    s.set([{ id: "b1", cmd: "npm test", start: 1_000_000 - 65_000 }]);
    expect(s.el.hidden).toBe(false);
    expect(titles(s)).toContain("⏳ npm test · 1m5s");
    vi.advanceTimersByTime(5_000);
    expect(titles(s)).toContain("1m10s");
  });

  it("shows ✓ for ok and ✗ for failed, with the run time", () => {
    const s = jobStrip();
    s.set([
      { id: "a", cmd: "build", start: 1_000_000 - 100_000, end: 1_000_000 - 10_000, ok: true },
      { id: "b", cmd: "lint", start: 1_000_000 - 30_000, end: 1_000_000 - 10_000, ok: false },
    ]);
    expect(titles(s)).toContain("✓ build · 1m30s");
    expect(titles(s)).toContain("✗ lint · 20s");
  });

  it("is a drawer: the arrow slides it in and out", () => {
    const s = jobStrip();
    s.set([{ id: "b1", cmd: "x", start: 1_000_000 }]);
    const tab = s.el.querySelector<HTMLButtonElement>(".tab")!;
    tab.click();
    expect(s.el.classList.contains("in")).toBe(true);
    tab.click();
    expect(s.el.classList.contains("in")).toBe(false);
  });

  it("a finished tube leaves the rack after 30s", () => {
    const s = jobStrip();
    s.set([{ id: "a", cmd: "build", start: 1_000_000 - 90_000, end: 1_000_000 - 5_000, ok: true }]);
    expect(s.el.querySelectorAll(".tube").length).toBe(1);
    vi.advanceTimersByTime(26_000);
    expect(s.el.querySelectorAll(".tube").length).toBe(0);
    expect(s.el.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops ticking when nothing runs", () => {
    const s = jobStrip();
    s.set([{ id: "b1", cmd: "x", start: 1_000_000 }]);
    s.set([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
