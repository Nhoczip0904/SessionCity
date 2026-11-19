// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { shelfStrip } from "../src/client/chatShelf.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const files = [
  { id: "a".repeat(16), scope: "user", path: "C:\\u\\.claude\\CLAUDE.md", size: 900 },
  { id: "b".repeat(16), scope: "project", path: "D:\\w\\app\\CLAUDE.md", size: 3000 },
  { id: "c".repeat(16), scope: "local", path: "D:\\w\\app\\CLAUDE.local.md", size: 200 },
];
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe("chat shelf strip", () => {
  it("shows one spine per loaded file with its path as tooltip; a click reveals that file", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => (init?.method === "POST" ? ok({}) : ok({ files, skills: [{ id: "s" }] })));
    const strip = shelfStrip("ses-1", f as unknown as typeof fetch);
    expect(strip.hidden).toBe(true);
    await tick();
    const books = strip.querySelectorAll<HTMLElement>(".book");
    expect(strip.hidden).toBe(false);
    expect(books).toHaveLength(3); // files only, no skills
    expect(books[1].title).toContain("D:\\w\\app\\CLAUDE.md");
    expect(books[1].textContent).toBe(""); // name only on hover
    books[1].dispatchEvent(new Event("mouseenter"));
    expect(strip.querySelector(".name")!.textContent).toBe("app");
    books[1].dispatchEvent(new Event("mouseleave"));
    expect(strip.querySelector(".name")!.textContent).toBe("");
    expect(parseInt(books[1].style.width)).toBeGreaterThan(parseInt(books[2].style.width)); // bigger file, thicker book
    books[1].click();
    expect(f).toHaveBeenLastCalledWith(`/api/session/ses-1/shelf/${"b".repeat(16)}/open`, { method: "POST" });
  });

  it("the arrow slides the shelf out of sight and back", async () => {
    const strip = shelfStrip("s", (async () => ok({ files, skills: [] })) as unknown as typeof fetch);
    await tick();
    const tab = strip.querySelector<HTMLElement>(".tab")!;
    expect(strip.classList.contains("in")).toBe(false);
    tab.click();
    expect(strip.classList.contains("in")).toBe(true);
    expect(tab.textContent).toBe("▸");
    tab.click();
    expect(strip.classList.contains("in")).toBe(false);
  });

  it("stays hidden when there are no files or the fetch fails", async () => {
    const none = shelfStrip("s", (async () => ok({ files: [], skills: [] })) as unknown as typeof fetch);
    const bad = shelfStrip("s", (async () => { throw new Error("x"); }) as unknown as typeof fetch);
    await tick();
    expect(none.hidden).toBe(true);
    expect(bad.hidden).toBe(true);
  });
});
