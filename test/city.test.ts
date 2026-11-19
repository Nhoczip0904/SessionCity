// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildCity, drawPark, ROADS, TILE } from "../src/client/city.js";
import { roadGraph } from "../src/client/roads.js";
import { findPath } from "../src/client/path.js";

describe("city layout", () => {
  const city = buildCity(null);
  it("every building faces down: its door is right below it", () => {
    for (const p of city.plots) expect(city.doors[p.id].y * TILE).toBe(p.px.y + p.px.h);
    for (const d of city.hqDoors) expect(d.y * TILE).toBe(city.hqPlots[0].y + city.hqPlots[0].h);
  });
  it("HQ is one building with 10 rooms: 10 doors along its front", () => {
    expect(city.hqPlots).toHaveLength(1);
    expect(city.hqDoors).toHaveLength(10);
    const r = city.hqPlots[0];
    for (const d of city.hqDoors) { expect(d.x * TILE).toBeGreaterThanOrEqual(r.x); expect(d.x * TILE).toBeLessThan(r.x + r.w); }
  });
  it("there is no residential plot: an idle session rests at the HQ", () => {
    expect(city.plots.some((p) => p.id === "home")).toBe(false);
    expect(city.doors.home).toEqual(city.hqDoors[0]);
  });
  it("every door can be reached from every other", () => {
    const all = [...Object.values(city.doors), ...city.hqDoors];
    for (const d of all.slice(1)) expect(findPath(city.walkable, all[0], d).length).toBeGreaterThan(0);
  });
  const tiles = (r: { x: number; y: number; w: number; h: number }) => {
    const out: { x: number; y: number }[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
    return out;
  };
  const px = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x / TILE, y: r.y / TILE, w: r.w / TILE, h: r.h / TILE });
  it("a river runs from the top edge to the bottom edge", () => {
    for (let y = 0; y < city.rows; y++) expect(city.walkable[y].some((_, x) => city.isRiver(x, y))).toBe(true);
  });
  it("roads cross the river only once, on the bridge", () => {
    const crossing = ROADS.filter((r) => tiles(r).some((t) => city.isRiver(t.x, t.y)));
    expect(crossing).toHaveLength(1);
    // on foot the river is crossed on the bridge only
    for (let y = 0; y < city.rows; y++)
      for (let x = 0; x < city.cols; x++)
        if (city.isRiver(x, y) && city.walkable[y][x]) expect(tiles(crossing[0])).toContainEqual({ x, y });
  });
  it("nothing is built on the river or a road", () => {
    const areas = [...city.plots.map((p) => px(p.px)), ...city.hqPlots.map(px)];
    for (const a of areas)
      for (const t of tiles(a)) {
        expect(city.isRiver(t.x, t.y)).toBe(false);
        expect(city.walkable[t.y][t.x]).toBe(false);
      }
  });
  it("the park is off the river, and its pavement leads to the streets and to every bench", () => {
    for (const t of tiles(px(city.plaza))) expect(city.isRiver(t.x, t.y)).toBe(false);
    const road = city.doors.library; // any street-side door
    for (const s of city.seats) expect(findPath(city.walkable, road, s).length).toBeGreaterThan(0);
  });
  it("cars can drive from any crossing to any other", () => {
    const g = roadGraph(ROADS), seen = new Set([0]), todo = [0];
    while (todo.length) for (const n of g.adj[todo.pop()!]) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    expect(seen.size).toBe(g.nodes.length);
  });
});

describe("street props", () => {
  it("every kind shows up and hash 1 stays free for the bench", async () => {
    const { streetKind } = await import("../src/client/cityDraw.js");
    const kinds = new Set(Array.from({ length: 2000 }, (_, h) => streetKind(h)));
    expect(kinds).toEqual(new Set(["hydrant", "bin", "mailbox", "bollard", null]));
  });
});

describe("park", () => {
  it("is built from the city's own tiles when the sheet is loaded:", async () => {
    const { Texture } = await import("pixi.js");
    const asked = new Set<number>();
    const tree = [403, 440, 747]; // tree top, tree bottom, pavement
    const root = drawPark({ city: (i: number) => (asked.add(i), Texture.EMPTY) } as never);
    expect(root.children.length).toBeGreaterThan(220); // one sprite per tile of the 20x11 lawn, plus trees and the pond layer
    for (const t of tree) expect(asked.has(t)).toBe(true);
  });
});
