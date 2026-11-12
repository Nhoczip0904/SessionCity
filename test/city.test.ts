import { describe, expect, it } from "vitest";
import { buildCity, ROADS, TILE } from "../src/client/city.js";
import { roadGraph } from "../src/client/roads.js";
import { findPath } from "../src/client/path.js";

describe("city layout", () => {
  const city = buildCity(null);
  it("every building faces down: its door is right below it", () => {
    for (const p of city.plots) expect(city.doors[p.id].y * TILE).toBe(p.px.y + p.px.h);
    city.hqPlots.forEach((r, i) => expect(city.hqDoors[i].y * TILE).toBe(r.y + r.h));
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
    const areas = [...city.plots.map((p) => px(p.px)), ...city.hqPlots.map(px), px(city.plaza)];
    for (const a of areas)
      for (const t of tiles(a)) {
        expect(city.isRiver(t.x, t.y)).toBe(false);
        expect(city.walkable[t.y][t.x]).toBe(false);
      }
  });
  it("cars can drive from any crossing to any other", () => {
    const g = roadGraph(ROADS), seen = new Set([0]), todo = [0];
    while (todo.length) for (const n of g.adj[todo.pop()!]) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    expect(seen.size).toBe(g.nodes.length);
  });
});
