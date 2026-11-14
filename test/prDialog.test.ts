// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPrBoard } from "../src/client/shelfDialog.js";
import type { RepoPrs } from "../src/shared/types.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => {
  document.body.innerHTML = "";
});

const DATA: RepoPrs[] = [
  { repo: "city", prs: [
    { number: 12, title: "Add board", url: "https://github.com/o/city/pull/12", author: "huy", draft: false, review: "approved", ci: "pass" },
    { number: 13, title: "<img src=x onerror=alert(1)>", url: null, author: null, draft: true, review: null, ci: null },
    { number: 14, title: "Fix", url: "https://github.com/o/city/pull/14", author: "an", draft: false, review: "changes", ci: "fail" },
    { number: 15, title: "Wip", url: "https://github.com/o/city/pull/15", author: "an", draft: false, review: "pending", ci: "pending" },
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
      "#14 Fix👤 an Cần sửa CI ✗",
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
});
