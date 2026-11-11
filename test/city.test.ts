import { describe, expect, it } from "vitest";
import { buildCity, TILE } from "../src/client/city.js";
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
});
