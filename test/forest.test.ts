import { describe, expect, it } from "vitest";
import { FOREST, planForest } from "../src/client/forest.js";
import { ROADS, buildCity } from "../src/client/city.js";
import { onRoad } from "../src/client/roads.js";
import * as K from "../src/client/tiles.js";

const COLS = 48, ROWS = 43, CITY = 32;
const riverLeft = buildCity(null).riverLeft;
const plan = planForest(COLS, ROWS, CITY, ROADS, riverLeft);
const inside = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < CITY;
const road = (x: number, y: number) => ROADS.some((r) => onRoad(r, x, y));

describe("planForest", () => {
  it("covers the whole square, the ground under the city included so no gap shows at the map's edge", () => {
    const side = COLS + 2 * FOREST, tall = ROWS + 2 * FOREST;
    const outsideWater = plan.water.length;
    expect(plan.ground.length + outsideWater).toBe(side * tall);
    expect(new Set(plan.ground.map((g) => `${g.x},${g.y}`)).size).toBe(plan.ground.length);
    expect(plan.ground.filter((g) => inside(g.x, g.y)).every((g) => !g.road && !g.walk)).toBe(true);
    expect(plan.water.some((w) => inside(w.x, w.y))).toBe(false);
    expect(plan.trees.some((t) => inside(t.x, t.y))).toBe(false);
    expect(plan.ground.some((g) => g.x === -FOREST && g.y === -FOREST)).toBe(true);
    expect(plan.ground.some((g) => g.x === COLS + FOREST - 1 && g.y === ROWS + FOREST - 1)).toBe(true);
  });
  it("the main road and both avenues run out to the edge of the forest", () => {
    const at = (x: number, y: number) => plan.ground.find((g) => g.x === x && g.y === y)!;
    for (const [x, y] of [[-FOREST, 15], [COLS + FOREST - 1, 16], [2, -FOREST], [45, -FOREST], [3, ROWS + FOREST - 1], [44, ROWS + FOREST - 1]]) expect(at(x!, y!).road, `${x},${y}`).toBe(true);
    expect(at(-5, 5).road).toBe(false);
  });
  it("the river runs on through the forest to both edges, in the same columns as at the city's edge", () => {
    const top = plan.water.filter((w) => w.y === -FOREST).map((w) => w.x);
    const bottom = plan.water.filter((w) => w.y === ROWS + FOREST - 1).map((w) => w.x);
    expect(top).toEqual([riverLeft(0), riverLeft(0) + 1, riverLeft(0) + 2]);
    expect(bottom).toEqual([riverLeft(ROWS - 1), riverLeft(ROWS - 1) + 1, riverLeft(ROWS - 1) + 2]);
    expect(riverLeft(-5)).toBe(riverLeft(0));
    expect(riverLeft(ROWS + 9)).toBe(riverLeft(ROWS - 1));
    // no bank across the water's own row: the river is one piece with the map's
    const edge = plan.water.find((w) => w.y === -1 && w.x === riverLeft(0))!;
    expect([edge.bankL, edge.bankR]).toEqual([true, false]);
  });
  it("trees keep off the water and its banks", () => {
    for (const t of plan.trees) for (const dx of [-1, 0, 1]) expect(t.x + dx >= riverLeft(t.y) && t.x + dx < riverLeft(t.y) + 3).toBe(false);
  });
  it("a road leaving the city has a sidewalk on both sides all the way out; farther off is grass", () => {
    const at = (x: number, y: number) => plan.ground.find((g) => g.x === x && g.y === y)!;
    expect([at(-5, 14).tile, at(-5, 17).tile]).toEqual([K.SIDEWALK_S, K.SIDEWALK_N]);
    expect([at(-FOREST, 14).walk, at(-FOREST, 17).walk]).toEqual([true, true]);
    expect([at(-5, 13).walk, at(-5, 18).walk]).toEqual([false, false]);
    expect(at(1, 40).walk || at(5, 40).walk).toBe(true); // the avenue's sidewalk below the city: x=1 is beside the road at x=2
    expect(K.GRASS).toContain(at(-5, 13).tile);
  });
  it("trees stand only on grass, a tile away from any road, with their crown outside the city", () => {
    expect(plan.trees.length).toBeGreaterThan(1000);
    for (const t of plan.trees) {
      expect(inside(t.x, t.y) || inside(t.x, t.y - 1)).toBe(false);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) expect(road(t.x + i, t.y + j)).toBe(false);
    }
  });
  it("the forest is thick but not solid: gaps and bushes between the trees", () => {
    const area = plan.ground.filter((g) => !g.road).length;
    expect(plan.trees.length / area).toBeGreaterThan(0.4);
    expect(plan.trees.length / area).toBeLessThan(0.8);
    expect(plan.bushes.length).toBeGreaterThan(50);
  });
  it("is the same every time, and trees come top to bottom so the lower ones overlap the upper", () => {
    expect(planForest(COLS, ROWS, CITY, ROADS, riverLeft)).toEqual(plan);
    const ys = plan.trees.map((t) => t.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });
});
