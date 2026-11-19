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

describe("trụ sở (home)", () => {
  it("shows 10 rooms, one per session with the portrait, and clicking opens the chat", () => {
    const chat = vi.fn();
    const el = draw({ id: "home", items: [{ id: "s1", project: "api", since: "2026-11-13T09:00:00Z", status: "idle" }] }, ctx({ chat, avatarOf: () => "data:img/x" }));
    expect(el.querySelectorAll(".chair")).toHaveLength(10);
    expect(el.querySelectorAll(".vacant")).toHaveLength(9);
    expect(el.querySelector(".chair img")!.getAttribute("src")).toBe("data:img/x");
    expect(el.querySelector(".chair small")!.textContent).toBe("nghỉ · 3 giờ trước");
    el.querySelector<HTMLButtonElement>(".chair")!.click();
    expect(chat).toHaveBeenCalledWith("s1");
  });
  it("copes with a session that has no portrait yet; a working session does not sleep", () => {
    const el = draw({ id: "home", items: [{ id: "s", project: "p", since: "2026-11-13T11:00:00Z", status: "working" }] });
    expect(el.querySelector(".chair img")).toBeNull();
    expect(el.querySelector(".chair.working .z")).toBeNull();
    expect(draw({ id: "home", items: [] }).querySelectorAll(".vacant")).toHaveLength(10);
  });
});
