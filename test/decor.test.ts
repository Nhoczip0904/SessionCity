// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { Actors } from "../src/client/actors.js";
import { buildCity } from "../src/client/city.js";
import { decorBox } from "../src/client/cityDraw.js";
import { findPath } from "../src/client/path.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

describe("decor houses", () => {
  it("sixteen packed houses of mixed height whose side doors open onto the avenue", () => {
    const city = buildCity(null);
    expect(city.decorDoors).toHaveLength(16);
    expect(city.decorPlots).toHaveLength(16);
    for (const d of city.decorDoors) {
      expect(city.walkable[d.y][d.x]).toBe(true);
      expect(findPath(city.walkable, { x: 3, y: 15 }, d).length).toBeGreaterThan(0);
    }
    expect(new Set(city.decorPlots.map((p) => p.h)).size).toBeGreaterThan(2); // low and tall
    const west = city.decorPlots.filter((p) => p.x === 0).sort((a, b) => a.y - b.y);
    west.slice(1).forEach((p, i) => expect(p.y).toBe(west[i]!.y + west[i]!.h + (p.y === 17 * 16 ? 32 : 0))); // side by side; only the main road (rows 15-16) breaks the row
    for (const p of city.decorPlots) expect(p.y + p.h <= 15 * 16 || p.y >= 17 * 16).toBe(true); // the main road runs out of the city between them
    for (const p of city.decorPlots) expect(city.walkable[Math.floor(p.y / 16) + 1][Math.floor(p.x / 16)]).toBe(false);
  });

  it("a tall house is three tiles wide and reaches outward, a low one two", () => {
    expect(decorBox({ x: 0, h: 5, side: 1 })).toEqual({ x: -1, w: 3 });
    expect(decorBox({ x: 46, h: 6, side: -1 })).toEqual({ x: 46, w: 3 });
    expect(decorBox({ x: 0, h: 3, side: 1 })).toEqual({ x: 0, w: 2 });
  });

  it("citizens walk into a decor house, vanish for a few seconds, and come out again", () => {
    const layer = new Container();
    const actors = new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: true, rand: () => 0.1 });
    let hidden = 0, back = false;
    const was = new Set<unknown>();
    for (let i = 0; i < 3000; i++) {
      actors.update(50);
      for (const c of layer.children) {
        if (!c.visible) { hidden++; was.add(c); }
        else if (was.has(c)) back = true;
      }
    }
    expect(hidden).toBeGreaterThan(0);
    expect(back).toBe(true);
  });
});
