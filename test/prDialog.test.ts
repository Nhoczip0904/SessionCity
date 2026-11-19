// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPrBoard } from "../src/client/shelfDialog.js";
import type { RepoPrs, Session } from "../src/shared/types.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => {
  document.body.innerHTML = "";
});

const DATA: RepoPrs[] = [
  { repo: "city", url: "https://github.com/o/city", prs: [
    { number: 12, title: "Add board", url: "https://github.com/o/city/pull/12", author: "huy", draft: false, review: "approved", ci: "pass", branch: "feat/board" },
    { number: 13, title: "<img src=x onerror=alert(1)>", url: null, author: null, draft: true, review: null, ci: null, branch: null },
    { number: 14, title: "Fix", url: "https://github.com/o/city/pull/14", author: "an", draft: false, review: "changes", ci: "fail", branch: "fix/x", conflict: true },
    { number: 15, title: "Wip", url: "https://github.com/o/city/pull/15", author: "an", draft: false, review: "pending", ci: "pending", branch: "wip" },
  ] },
  { repo: "empty", prs: [] },
  { repo: "broken", prs: [], error: "gh auth login required" },
];

describe("the PR board on the main screen", () => {
  it("groups PRs by repo; every PR shows who made it and its review and CI state, even when there is none yet; each links to GitHub in a new tab", async () => {
    const d = renderPrBoard(async () => DATA);
    expect(d.textContent).toContain("Đang tải");
    await tick();
    expect([...d.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["city", "empty", "broken"]);
    const rows = [...d.querySelectorAll<HTMLElement>(".pr")];
    expect(rows.map((r) => r.textContent)).toEqual([
      "#12 Add board👤 huy Đã duyệt CI ✓",
      "#13 <img src=x onerror=alert(1)>👤 ? Draft Chưa review Chưa có CI",
      "#14 Fix👤 an Xung đột Cần sửa CI ✗",
      "#15 Wip👤 an Chờ review CI ⏳",
    ]);
    const a = rows[0] as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.href).toBe("https://github.com/o/city/pull/12");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(rows[1]!.tagName).not.toBe("A"); // no safe link, no link
    expect(d.querySelector("img")).toBeNull();
    expect(d.textContent).toContain("Không có PR đang mở");
    expect(d.textContent).toContain("gh auth login required");
  });

  it("names the sessions working on a PR's branch under it; PRs nobody works on get no line", async () => {
    const s = (id: string, branch: string | undefined, title?: string): Session => ({ id, project: "city", cwd: "C:/city", branch, title, lastActivity: "", status: "idle", district: "home", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byModel: {} }, employees: [] });
    const all = [s("a", "feat/board", "Bảng PR"), s("b", "feat/board"), s("c", "other"), s("d", undefined)];
    const d = renderPrBoard(async () => DATA, 20_000, () => all);
    await tick();
    const rows = [...d.querySelectorAll<HTMLElement>(".pr")];
    expect([...rows[0]!.querySelectorAll(".sess")].map((x) => x.textContent)).toEqual(["💬 Bảng PR", "💬 city"]);
    expect(rows[1]!.querySelector(".sess")).toBeNull(); // PR without a branch
    expect(rows[2]!.querySelector(".sess")).toBeNull();
  });

  it("a repo name with a GitHub address opens the repo in a new tab; one without stays plain text", async () => {
    const d = renderPrBoard(async () => DATA);
    await tick();
    const [city, empty] = [...d.querySelectorAll("h3")];
    const a = city!.querySelector("a")!;
    expect(a.href).toBe("https://github.com/o/city");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(empty!.querySelector("a")).toBeNull();
  });

  it("says so when no session is in a git repo, or the load fails", async () => {
    const d = renderPrBoard(async () => []);
    await tick();
    expect(d.textContent).toContain("Chưa có session nào trong repo git");
    const e = renderPrBoard(async () => { throw new Error("x"); });
    await tick();
    expect(e.textContent).toContain("Không tải được danh sách PR");
  });

  it("Làm mới asks again, skipping the cache", async () => {
    const load = vi.fn(async (_fresh: boolean) => DATA);
    const d = renderPrBoard(load);
    await tick();
    d.querySelector<HTMLButtonElement>("button.refresh")!.click();
    await tick();
    expect(load.mock.calls.map((c) => c[0])).toEqual([false, true]);
    expect(d.querySelectorAll(".pr").length).toBe(4);
  });

  it("is a panel, not a dialog, and its title bar folds the list away and back", async () => {
    const d = renderPrBoard(async () => DATA);
    await tick();
    expect(d.id).toBe("prs");
    expect(d.classList.contains("dialog")).toBe(false);
    const fold = d.querySelector<HTMLButtonElement>("button.fold")!;
    fold.click();
    expect(d.classList.contains("folded")).toBe(true);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fold.click();
    expect(d.classList.contains("folded")).toBe(false);
  });

  it("asks again on its own while it is on the page, without blanking the list", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async (_fresh: boolean) => DATA);
      const d = renderPrBoard(load, 1000);
      document.body.append(d);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(load.mock.calls.map((c) => c[0])).toEqual([false, false]);
      expect(d.textContent).not.toContain("Đang tải");
      expect(d.querySelectorAll(".pr").length).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a refresh keeps the scroll position, and a hidden tab does not poll", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async (_fresh: boolean) => DATA);
      const d = renderPrBoard(load, 1000);
      document.body.append(d);
      await vi.advanceTimersByTimeAsync(0);
      const body = d.querySelector<HTMLElement>(".body")!;
      body.scrollTop = 40;
      await vi.advanceTimersByTimeAsync(1000);
      expect(body.scrollTop).toBe(40);
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      await vi.advanceTimersByTimeAsync(3000);
      expect(load).toHaveBeenCalledTimes(2); // nothing while hidden
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(3); // back on screen: fresh list right away
    } finally {
      vi.useRealTimers();
    }
  });
});
