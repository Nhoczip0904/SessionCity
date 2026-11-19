// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { Actors } from "../src/client/actors.js";
import { buildCity } from "../src/client/city.js";
import { MAX_PROPS, SANDBOX_KEY, mountProps, readProps } from "../src/client/sandbox.js";
import { Traffic } from "../src/client/traffic.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);
const sheets = { city: () => Texture.WHITE, char: () => Texture.WHITE } as never;
const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("sandbox props", () => {
  it("places, saves, reloads and erases objects", () => {
    const s = store();
    const layer = new Container();
    const p = mountProps(layer, sheets, s);
    expect(p.add("tree", { x: 40, y: 50 })).toBe(true);
    p.add("bench", { x: 200, y: 50 });
    expect(readProps(s)).toHaveLength(2);
    const again = new Container();
    mountProps(again, sheets, s);
    expect(again.children.length).toBeGreaterThan(0);
    expect(p.erase({ x: 42, y: 52 }, 12)).toBe(true);
    expect(readProps(s)).toEqual([{ kind: "bench", x: 200, y: 50 }]);
    expect(p.erase({ x: 0, y: 0 }, 5)).toBe(false);
  });

  it("is capped, and bad storage is ignored", () => {
    const s = store();
    const p = mountProps(new Container(), sheets, s);
    for (let i = 0; i < MAX_PROPS; i++) expect(p.add("lamp", { x: i, y: i })).toBe(true);
    expect(p.add("lamp", { x: 1, y: 1 })).toBe(false);
    s.setItem(SANDBOX_KEY, "{oops");
    expect(readProps(s)).toEqual([]);
    s.setItem(SANDBOX_KEY, JSON.stringify([{ kind: "ufo", x: 1, y: 1 }, { kind: "tree", x: "a", y: 2 }, { kind: "tree", x: 3, y: 4 }]));
    expect(readProps(s)).toEqual([{ kind: "tree", x: 3, y: 4 }]);
  });
});

describe("sandbox spawns", () => {
  it("spawnCitizen adds one walker near the point", () => {
    const layer = new Container();
    const actors = new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: false, rand: () => 0.5 });
    const before = layer.children.length;
    actors.spawnCitizen({ x: 100, y: 100 });
    expect(layer.children.length).toBe(before + 1);
  });

  it("Traffic.add puts one more car on the road, up to a cap", () => {
    const layer = new Container();
    const traffic = new Traffic(layer, sheets, () => 0.4);
    const n = layer.children.length;
    expect(traffic.add()).toBe(true);
    expect(layer.children.length).toBe(n + 1);
    while (traffic.add());
    expect(traffic.add()).toBe(false);
  });
});
