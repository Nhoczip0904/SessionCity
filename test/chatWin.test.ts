// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { clampGeo, defaultGeo, floatable, loadGeo, saveGeo, snapGeo, type Geo } from "../src/client/chatWin.js";

const g = (o: Partial<Geo> = {}): Geo => ({ x: 100, y: 100, w: 400, h: 400, min: false, ...o });

describe("clampGeo", () => {
  it("keeps a window inside the page, below the HUD, and above a minimum size", () => {
    expect(clampGeo(g({ x: -50, y: 0 }), 1000, 800)).toMatchObject({ x: 0, y: 34 });
    expect(clampGeo(g({ x: 900, y: 790 }), 1000, 800)).toMatchObject({ x: 600, y: 800 - 400 });
    expect(clampGeo(g({ w: 10, h: 10 }), 1000, 800)).toMatchObject({ w: 300, h: 240 });
    expect(clampGeo(g({ w: 5000, h: 5000 }), 1000, 800)).toMatchObject({ w: 1000, h: 766 });
  });
  it("a minimized window only needs its title bar to fit", () => {
    expect(clampGeo(g({ min: true, y: 790 }), 1000, 800).y).toBe(800 - 46);
  });
});

describe("snapGeo", () => {
  const o = g({ x: 500, y: 100, w: 300, h: 400 }); // other window: x 500..800, y 100..500
  it("a window dragged near another's edge sits flush against it", () => {
    expect(snapGeo(g({ x: 95 }), [o]).x).toBe(100); // its right edge meets o's left edge
    expect(snapGeo(g({ x: 805 }), [o]).x).toBe(800); // its left edge meets o's right edge
    expect(snapGeo(g({ x: 505, y: 505, h: 200 }), [o])).toMatchObject({ x: 500, y: 500 }); // below: aligned and touching
  });
  it("dragging further than the pull overlaps freely", () => {
    expect(snapGeo(g({ x: 300 }), [o]).x).toBe(300);
    expect(snapGeo(g({ x: 95, y: 700 }), [o]).x).toBe(95); // not beside it at all: no pull
  });
  it("a minimized window counts by its bar height", () => {
    expect(snapGeo(g({ x: 500, y: 150 }), [{ ...o, min: true }]).y).toBe(146);
  });
});

describe("defaultGeo", () => {
  it("staggers windows leftwards from the right edge", () => {
    const a = defaultGeo(0, 1600, 900);
    const b = defaultGeo(1, 1600, 900);
    expect(b.x).toBeLessThan(a.x);
    expect(a.x + a.w).toBeLessThanOrEqual(1600);
    expect(a.y).toBeGreaterThanOrEqual(34);
  });
});

describe("load/save", () => {
  afterEach(() => localStorage.clear());
  it("round-trips, and ignores garbage", () => {
    saveGeo("s1", g());
    expect(loadGeo("s1")).toEqual(g());
    localStorage.setItem("chat-win:s2", "{nope");
    expect(loadGeo("s2")).toBeNull();
    localStorage.setItem("chat-win:s3", JSON.stringify({ x: "a" }));
    expect(loadGeo("s3")).toBeNull();
    expect(loadGeo("none")).toBeNull();
  });
});

describe("floatable", () => {
  const mk = (geo = g()) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    const bar = document.createElement("div");
    const close = document.createElement("button");
    close.className = "close";
    bar.append(close);
    box.append(bar);
    document.body.append(box);
    let saved: Geo | null = null;
    const w = floatable(box, bar, geo, (x) => (saved = x));
    const fire = (el: EventTarget, type: string, x: number, y: number) => el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }));
    return { box, bar, close, w, fire, saved: () => saved };
  };
  Object.assign(window, { innerWidth: 1200, innerHeight: 800 });

  it("places the box from its geometry", () => {
    const { box } = mk();
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(["100px", "100px", "400px", "400px"]);
  });
  it("dragging the title bar moves the box and saves", () => {
    const { box, bar, fire, saved } = mk();
    fire(bar, "pointerdown", 150, 110);
    fire(window, "pointermove", 250, 160);
    fire(window, "pointerup", 250, 160);
    expect([box.style.left, box.style.top]).toEqual(["200px", "150px"]);
    expect(saved()).toMatchObject({ x: 200, y: 150 });
    fire(window, "pointermove", 600, 600); // released: no more movement
    expect(box.style.left).toBe("200px");
  });
  it("pressing a button in the bar does not start a drag", () => {
    const { box, close, fire } = mk();
    fire(close, "pointerdown", 150, 110);
    fire(window, "pointermove", 250, 160);
    expect(box.style.left).toBe("100px");
  });
  it("dragging an edge handle resizes; the west/north edges move the origin", () => {
    const { box, fire } = mk();
    const rz = (d: string) => box.querySelector<HTMLElement>(`.rz[data-d="${d}"]`)!;
    fire(rz("se"), "pointerdown", 500, 500);
    fire(window, "pointermove", 560, 540);
    fire(window, "pointerup", 560, 540);
    expect([box.style.width, box.style.height]).toEqual(["460px", "440px"]);
    fire(rz("nw"), "pointerdown", 100, 100);
    fire(window, "pointermove", 80, 90);
    fire(window, "pointerup", 80, 90);
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(["80px", "90px", "480px", "450px"]);
  });
  it("resizing stops at the minimum size without shifting the far edge", () => {
    const { box, fire } = mk();
    fire(box.querySelector(".rz[data-d=\"w\"]")!, "pointerdown", 100, 300);
    fire(window, "pointermove", 900, 300);
    fire(window, "pointerup", 900, 300);
    expect([box.style.left, box.style.width]).toEqual(["200px", "300px"]);
  });
  it("the – button and a double click on the bar minimize and restore", () => {
    const { box, bar, w, fire } = mk();
    box.querySelector<HTMLElement>(".minb")!.click();
    expect(box.classList.contains("min")).toBe(true);
    expect(w.geo().min).toBe(true);
    bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(box.classList.contains("min")).toBe(false);
    void fire;
  });
  it("a click on a window raises it above the others", () => {
    const a = mk();
    const aBox = a.box;
    const second = document.createElement("div");
    const bar2 = document.createElement("div");
    second.append(bar2);
    document.body.append(second);
    floatable(second, bar2, g(), () => {});
    second.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    aBox.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(Number(aBox.style.zIndex)).toBeGreaterThan(Number(second.style.zIndex));
  });
  it("destroy stops listening", () => {
    const { box, bar, w, fire } = mk();
    fire(bar, "pointerdown", 150, 110);
    w.destroy();
    fire(window, "pointermove", 250, 160);
    expect(box.style.left).toBe("100px");
  });
});
