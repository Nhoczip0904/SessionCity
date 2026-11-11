// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderFilesDialog, renderShelfDialog, renderTokenDialog } from "../src/client/shelfDialog.js";
import { showDialog } from "../src/client/launcher.js";
import type { Employee, Shelf } from "../src/shared/types.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("renderTokenDialog", () => {
  it("renders model names as text and totals", () => {
    const d = renderTokenDialog({ rows: [["<script>x</script>", "1", "2", "3", "4"]], total: ["Tổng", "1", "2", "3", "4"], staff: 5 });
    expect(d.querySelector("script")).toBeNull();
    expect(d.textContent).toContain("<script>x</script>");
    expect(d.textContent).toContain("Két token");
    expect(d.textContent).toContain("Cache đọc");
    expect(d.textContent).toContain("Trong đó nhân viên: 5 token");
  });
  it("null shows empty message", () => {
    expect(renderTokenDialog(null).textContent).toContain("Chưa dùng token nào");
  });
});

describe("renderFilesDialog", () => {
  it("click picks and removes", () => {
    const e = { id: "e1", type: "Explore", description: "tìm", endedAt: "2026-01-01T10:05:00" } as unknown as Employee;
    const onPick = vi.fn();
    const d = renderFilesDialog([e], onPick);
    showDialog(d);
    (d.querySelector(".row") as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith("e1");
    expect(d.isConnected).toBe(false);
  });
  it("empty", () => {
    expect(renderFilesDialog([], () => {}).textContent).toContain("Chưa có báo cáo nào");
  });
});

const shelf: Shelf = {
  files: [{ id: "f1", scope: "user", path: "~/CLAUDE.md", size: 3 }, { id: "f2", scope: "local", path: "x/CLAUDE.local.md", size: 3 }],
  skills: [{ id: "s1", scope: "plugin", plugin: "sp", name: "tdd", description: "desc", used: true }, { id: "s2", scope: "project", name: "p", description: "", used: false }],
};

describe("renderShelfDialog", () => {
  it("lists sections, opens, goes back, notes truncation", async () => {
    const d = renderShelfDialog(async () => shelf, async () => ({ text: "<b>hi</b>", truncated: true }));
    await tick();
    const t = d.textContent!;
    for (const s of ["File nạp sẵn", "Skill", "của bạn", "local", "plugin sp", "dự án", "đã dùng"]) expect(t).toContain(s);
    (d.querySelector(".row") as HTMLElement).click();
    await tick();
    expect(d.querySelector("pre")!.textContent).toBe("<b>hi</b>");
    expect(d.textContent).toContain("Đã cắt ở 64 KB");
    (Array.from(d.querySelectorAll("button")).find((b) => b.textContent === "← Kệ sách") as HTMLElement).click();
    expect(d.querySelector("pre")).toBeNull();
    expect(d.textContent).toContain("File nạp sẵn");
  });
  it("empty and error", async () => {
    const a = renderShelfDialog(async () => ({ files: [], skills: [] }), async () => ({ text: "", truncated: false }));
    await tick();
    expect(a.textContent).toContain("Không thấy file hay skill nào");
    const b = renderShelfDialog(async () => { throw new Error("x"); }, async () => ({ text: "", truncated: false }));
    await tick();
    expect(b.textContent).toContain("Không tải được kệ sách");
  });
});
