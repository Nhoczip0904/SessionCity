// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { districtInfo } from "../src/shared/districts.js";
import { Tooltip, plotAt, presentAt, renderDistrictCard } from "../src/client/tooltip.js";

describe("renderDistrictCard", () => {
  it("district card lists examples and caps present names at 6", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const el = renderDistrictCard(districtInfo("library"), names);
    expect(el.textContent).toContain("Thư viện");
    expect(el.textContent).toContain("Khảo sát code");
    expect(el.textContent).toContain("Agent tới đây khi:");
    expect(el.querySelectorAll("li").length).toBe(4);
    const t = el.textContent!;
    expect(t).toContain("a, b, c, d, e, f");
    expect(t).not.toContain("f, g");
    expect(t).toMatch(/Đang có mặt:.*…/);
  });
  it("names render as text; no examples → no examples section", () => {
    const el = renderDistrictCard(districtInfo("home"), ["<img src=x>"]);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).not.toContain("Agent tới đây khi:");
  });
});

describe("plotAt", () => {
  const plots = [{ id: "lab" as const, px: { x: 10, y: 10, w: 20, h: 20 } }];
  it("hits inside, misses outside", () => {
    expect(plotAt(plots, 15, 15)?.id).toBe("lab");
    expect(plotAt(plots, 30, 15)).toBeUndefined();
    expect(plotAt(plots, 5, 5)).toBeUndefined();
  });
});

describe("Tooltip", () => {
  it("shows near the cursor, clamps in viewport, hides", () => {
    const el = document.createElement("div");
    const t = new Tooltip(el);
    Object.defineProperty(el, "offsetWidth", { value: 200 });
    Object.defineProperty(el, "offsetHeight", { value: 100 });
    t.show(document.createElement("div"), 50, 60, 1000, 800);
    expect(el.hidden).toBe(false);
    expect(parseInt(el.style.left)).toBe(64);
    expect(parseInt(el.style.top)).toBe(74);
    t.show(document.createElement("div"), 990, 790, 1000, 800);
    expect(parseInt(el.style.left)).toBe(800);
    expect(parseInt(el.style.top)).toBe(700);
    t.hide();
    expect(el.hidden).toBe(true);
  });
});

describe("presentAt", () => {
  it("lists sessions and only working employees in the district", () => {
    const sessions = [{ district: "lab", project: "p1" }, { district: "site", project: "p2" }];
    const employees = [
      { district: "lab", type: "Explore", status: "working" },
      { district: "lab", type: "Done1", status: "done" },
      { district: "lab", type: "Wait", status: "waiting" },
    ];
    expect(presentAt("lab", sessions as never, employees as never)).toEqual(["p1", "Explore"]);
  });
});
