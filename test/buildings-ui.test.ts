// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildingData } from "../src/shared/types.js";
import { ago, renderBuilding, renderBuildingDialog, seconds, type BuildingCtx } from "../src/client/buildings.js";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const ctx = (over: Partial<BuildingCtx> = {}): BuildingCtx => ({ avatarOf: () => null, chat: () => {}, now: () => NOW, ...over });
const draw = (d: BuildingData, c = ctx()) => renderBuilding(d, c);
const run = (over: object = {}) => ({ at: "2026-11-13T11:55:00Z", project: "api", command: "npm test", ok: true as boolean | null, ms: 2500, note: "5 passed", ...over });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("helpers", () => {
  it("ago says how long ago in Vietnamese", () => {
    expect(ago("2026-11-13T11:59:50Z", NOW)).toBe("vừa xong");
    expect(ago("2026-11-13T11:55:00Z", NOW)).toBe("5 phút trước");
    expect(ago("2026-11-13T09:00:00Z", NOW)).toBe("3 giờ trước");
    expect(ago("2026-11-10T12:00:00Z", NOW)).toBe("3 ngày trước");
    expect(ago("garbage", NOW)).toBe("");
  });
  it("seconds shortens a duration", () => {
    expect([seconds(null), seconds(450), seconds(2500)]).toEqual(["…", "450ms", "2.5s"]);
  });
});

describe("hộp thư (townhall)", () => {
  const d: BuildingData = { id: "townhall", items: [{ id: "s1", project: "api", title: "Fix login", said: "Bạn muốn dùng JWT hay session?", at: "2026-11-13T11:30:00Z" }] };
  it("is a letter per waiting session, with what Claude asked and a way to answer", () => {
    const chat = vi.fn();
    const el = draw(d, ctx({ chat }));
    expect(el.querySelector(".letter header b")!.textContent).toBe("Fix login");
    expect(el.querySelector("blockquote")!.textContent).toContain("JWT");
    el.querySelector<HTMLButtonElement>("button")!.click();
    expect(chat).toHaveBeenCalledWith("s1");
  });
  it("says so when nobody waits", () => {
    expect(draw({ id: "townhall", items: [] }).textContent).toContain("Không ai đang chờ");
  });
});

describe("phòng khách (home)", () => {
  it("seats each sleeper in an armchair with the portrait, and waking opens the chat", () => {
    const chat = vi.fn();
    const el = draw({ id: "home", items: [{ id: "s1", project: "api", since: "2026-11-13T09:00:00Z" }] }, ctx({ chat, avatarOf: () => "data:img/x" }));
    expect(el.querySelector(".chair img")!.getAttribute("src")).toBe("data:img/x");
    expect(el.querySelector(".chair small")!.textContent).toBe("ngủ 3 giờ");
    el.querySelector<HTMLButtonElement>(".chair")!.click();
    expect(chat).toHaveBeenCalledWith("s1");
  });
  it("copes with a session that has no portrait yet, and with nobody resting", () => {
    expect(draw({ id: "home", items: [{ id: "s", project: "p", since: "2026-11-13T11:00:00Z" }] }).querySelector(".chair img")).toBeNull();
    expect(draw({ id: "home", items: [] }).textContent).toContain("Không ai đang nghỉ");
  });
});

describe("bản vẽ thi công (site)", () => {
  it("builds a wall: a brick per file, coloured by what happened to it, with the repo's totals", () => {
    const el = draw({ id: "site", repos: [{ repo: "app", files: [{ path: "src/a.ts", status: "A", add: 30, del: 0 }, { path: "b.ts", status: "M", add: 2, del: 5 }, { path: "c", status: "D", add: 0, del: 9 }, { path: "d", status: "?", add: 0, del: 0 }] }] });
    expect([...el.querySelectorAll(".brick")].map((b) => b.className.replace("brick ", ""))).toEqual(["kA", "kM", "kD", "ku"]);
    expect(el.querySelector("h3")!.textContent).toBe("app +32 −14");
    expect(el.querySelector(".brick")!.textContent).toBe("a.ts");
    expect((el.querySelector(".brick") as HTMLElement).title).toContain("src/a.ts");
    // the more lines changed, the bigger the brick
    const grow = (n: number) => Number((el.querySelectorAll<HTMLElement>(".brick")[n]).style.flexGrow);
    expect(grow(0)).toBeGreaterThan(grow(1));
  });
  it("shows a clean repo and a failing one", () => {
    const el = draw({ id: "site", repos: [{ repo: "clean", files: [] }, { repo: "bad", files: [], error: "fatal: nope" }] });
    expect(el.textContent).toContain("Sạch");
    expect(el.textContent).toContain("fatal: nope");
  });
});

describe("phòng thí nghiệm (lab)", () => {
  it("shows the latest run on a monitor and every run as a tube", () => {
    const el = draw({ id: "lab", runs: [run({ note: "454 passed" }), run({ ok: false }), run({ ok: null })] });
    expect(el.querySelector(".monitor")!.className).toContain("ok");
    expect(el.querySelector(".monitor")!.textContent).toContain("PASS");
    expect(el.querySelector(".monitor")!.textContent).toContain("454 passed");
    expect([...el.querySelectorAll(".tube")].map((t) => t.className.replace("tube ", ""))).toEqual(["run", "bad", "ok"]); // oldest on the left
    expect(el.textContent).toContain("1/3 lần gần nhất đạt");
  });
  it("a failing latest run shows red", () => {
    const el = draw({ id: "lab", runs: [run({ ok: false })] });
    expect(el.querySelector(".monitor")!.className).toContain("bad");
    expect(el.querySelector(".monitor")!.textContent).toContain("FAIL");
  });
  it("is empty without runs", () => {
    expect(draw({ id: "lab", runs: [] }).textContent).toContain("Chưa thấy lần chạy test");
  });
});

describe("dây chuyền (factory)", () => {
  it("rides each build as a crate, bigger when it took longer, with the average", () => {
    const el = draw({ id: "factory", runs: [run({ ms: 1000 }), run({ ms: 9000, ok: false, note: "error CS1002" })] });
    const crates = [...el.querySelectorAll<HTMLElement>(".crate")];
    expect(crates.map((c) => c.className.replace("crate ", ""))).toEqual(["bad", "ok"]);
    expect(parseInt(crates[0].style.minWidth)).toBeGreaterThan(parseInt(crates[1].style.minWidth));
    expect(el.textContent).toContain("trung bình 5.0s");
    expect(el.textContent).toContain("Lỗi gần nhất: error CS1002");
  });
  it("is empty without builds", () => {
    expect(draw({ id: "factory", runs: [] }).textContent).toContain("Chưa thấy lần build");
  });
});

describe("bảng chuyến bay (airport)", () => {
  it("lists pushes as flights and CI runs as the runway", () => {
    const el = draw({
      id: "airport",
      flights: [run({ command: "git push", ok: true }), run({ command: "kubectl apply", ok: false }), run({ command: "gh pr create", ok: null })],
      ci: [{ repo: "app", runs: [{ name: "CI", branch: "main", at: "2026-11-13T10:00:00Z", state: "fail", url: null }] }, { repo: "old", runs: [], error: "gh: no" }],
    });
    const text = el.textContent!;
    expect(text).toContain("ĐÃ CẤT CÁNH");
    expect(text).toContain("HOÃN");
    expect(text).toContain("ĐANG BAY");
    expect(text).toContain("api › git push");
    expect(text).toContain("app › CI (main)");
    expect(text).toContain("CHẶN");
    expect(text).toContain("gh: no");
  });
  it("says so when there are no flights", () => {
    expect(draw({ id: "airport", flights: [], ci: [] }).textContent).toContain("chưa có chuyến nào");
  });
});

describe("tháp canh (watchtower)", () => {
  it("prints each alert as a line of the radar feed, with a count", () => {
    const el = draw({ id: "watchtower", alerts: [{ at: "2026-11-13T10:00:00Z", project: "api", tool: "Bash", text: "npm ERR!" }, { at: "2026-11-13T09:00:00Z", project: "web", tool: "Read", text: "no such file" }] });
    expect(el.querySelectorAll(".line").length).toBe(2);
    expect(el.querySelector(".line")!.textContent).toContain("api›Bash");
    expect(el.querySelector(".line")!.textContent).toContain("npm ERR!");
    expect(el.querySelector(".sweep")!.textContent).toBe("2 cảnh báo · 2 phiên");
  });
  it("is quiet without alerts", () => {
    expect(draw({ id: "watchtower", alerts: [] }).textContent).toContain("không có tín hiệu lạ");
  });
});

describe("kệ sách (library)", () => {
  it("stands a spine per file, taller for the more read, named after the file", () => {
    const el = draw({ id: "library", books: [{ path: "C:/r/src/a.ts", reads: 10, project: "api" }, { path: "C:/r/b.ts", reads: 1, project: "api" }] });
    const spines = [...el.querySelectorAll<HTMLElement>(".book")];
    expect(spines.map((s) => s.querySelector("span")!.textContent)).toEqual(["a.ts", "b.ts"]);
    expect(parseInt(spines[0].style.height)).toBeGreaterThan(parseInt(spines[1].style.height));
    expect(spines[0].title).toContain("10 lần đọc");
  });
  it("is empty without reads", () => {
    expect(draw({ id: "library", books: [] }).textContent).toContain("Chưa ai đọc");
  });
});

describe("bàn vẽ (design)", () => {
  it("pins a sheet per document with its progress", () => {
    const el = draw({ id: "design", docs: [
      { repo: "app", path: "docs/plans/x.md", title: "Plan X", done: 2, total: 4, at: "2026-11-13T11:00:00Z" },
      { repo: "app", path: "docs/specs/y.md", title: "Spec Y", done: 0, total: 0, at: "2026-11-12T11:00:00Z" },
    ] });
    const sheets = el.querySelectorAll(".sheet");
    expect(sheets[0].querySelector("b")!.textContent).toBe("Plan X");
    expect((sheets[0].querySelector(".bar i") as HTMLElement).style.width).toBe("50%");
    expect(sheets[0].textContent).toContain("2/4 việc xong");
    expect(sheets[1].querySelector(".bar")).toBeNull();
    expect(sheets[1].textContent).toContain("không có checklist");
  });
});

describe("sổ migration (database)", () => {
  it("is a timeline per repo; a migration from the last day is marked new", () => {
    const el = draw({ id: "database", repos: [{ repo: "api", items: [{ name: "20261113_AddUsers.cs", at: "2026-11-13T08:00:00Z" }, { name: "20260101_Init.cs", at: "2026-01-01T00:00:00Z" }] }] });
    const items = el.querySelectorAll("li");
    expect(items[0].querySelector("b")!.textContent).toBe("20261113_AddUsers");
    expect(items[0].querySelector(".tag")!.textContent).toBe("mới");
    expect(items[1].querySelector(".tag")).toBeNull();
  });
});

describe("renderBuildingDialog", () => {
  it("loads the board into a titled dialog, and Làm mới asks for a fresh one", async () => {
    const load = vi.fn(async () => ({ id: "library", books: [] }) as BuildingData);
    const root = renderBuildingDialog("library", load, ctx());
    document.body.append(root);
    await vi.waitFor(() => expect(root.textContent).toContain("Chưa ai đọc"));
    expect(root.querySelector("h2")!.textContent).toContain("Kệ sách");
    expect(root.className).toContain("bd-library");
    expect(load).toHaveBeenCalledWith(false);
    root.querySelector<HTMLButtonElement>("button.go")!.click();
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(true));
  });

  it("says so when the board does not load", async () => {
    const root = renderBuildingDialog("lab", async () => { throw new Error("x"); }, ctx());
    await vi.waitFor(() => expect(root.textContent).toContain("Không tải được"));
  });

  it("answering from a board closes it and opens the chat", async () => {
    const chat = vi.fn();
    const root = renderBuildingDialog("townhall", async () => ({ id: "townhall", items: [{ id: "s1", project: "p", said: "?", at: "2026-11-13T11:00:00Z" }] }), ctx({ chat }));
    document.body.append(root);
    await vi.waitFor(() => expect(root.querySelector(".letter")).not.toBeNull());
    root.querySelector<HTMLButtonElement>(".letter button")!.click();
    expect(chat).toHaveBeenCalledWith("s1");
    expect(document.body.contains(root)).toBe(false);
  });
});
