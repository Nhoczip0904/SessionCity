import { describe, expect, it } from "vitest";
import { CITY_EDGE, FOREST, RESORT, RAIL_X, SAND_FROM, SEA_FROM, STATION, STATION_ROUTE, msToNextStop, planForest, sandFrom, trainClock } from "../src/client/forest.js";
import { ROADS, buildCity } from "../src/client/city.js";
import { onRoad } from "../src/client/roads.js";
import * as K from "../src/client/tiles.js";

const COLS = 48, ROWS = 43, CITY = 32;
const riverLeft = buildCity(null).riverLeft;
const plan = planForest(COLS, ROWS, CITY, ROADS, riverLeft);
const inside = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < CITY;
const road = (x: number, y: number) => ROADS.some((r) => onRoad(r, x, y));
const shownRoad = (x: number, y: number) => road(x, y) && x < COLS + sandFrom(y) + 2; // the main road ends in the sand

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
    for (const [x, y] of [[-FOREST, 15], [2, -FOREST], [45, -FOREST], [3, ROWS + FOREST - 1], [44, ROWS + FOREST - 1]]) expect(at(x!, y!).road, `${x},${y}`).toBe(true);
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
    const area = plan.ground.filter((g) => !g.road).length - plan.sand.length - plan.sea.length; // the beach is not forest
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

describe("station and beach", () => {
  it("the beach is east only: sand then sea, no trees on it, and roads stay roads", () => {
    expect(plan.sand.length).toBeGreaterThan(0);
    expect(plan.sea.length).toBeGreaterThan(0);
    expect(plan.sand.every((t) => t.x >= COLS + SAND_FROM - 2) && plan.sea.every((t) => t.x >= COLS + SEA_FROM)).toBe(true);
    expect(plan.trees.some((t) => t.x >= COLS + sandFrom(t.y))).toBe(false);
    expect(plan.sea.some((t) => shownRoad(t.x, t.y))).toBe(false);
    expect(new Set(plan.sea.filter((t) => t.depth === 0).map((t) => t.x)).size).toBeGreaterThan(1); // the shore is not a straight line
    const props = new Set(plan.sand.map((t) => t.prop));
    expect(props.has("palm") && props.has("umbrella")).toBe(true);
    expect(plan.sand.filter((t) => t.prop).some((t) => shownRoad(t.x, t.y) || shownRoad(t.x, t.y - 1) || shownRoad(t.x, t.y + 1))).toBe(false);
    expect(plan.sand.some((t) => shownRoad(t.x, t.y))).toBe(false);
  });
  it("the station site is clear of trees and not on the road", () => {
    expect(plan.trees.some((t) => t.x === RAIL_X || (t.x >= RAIL_X - 1 && t.x <= STATION.x + STATION.w && t.y >= STATION.y - 4 && t.y <= STATION.y + STATION.h + 4))).toBe(false);
    for (let x = STATION.x; x < STATION.x + STATION.w; x++) for (let y = STATION.y; y < STATION.y + STATION.h; y++) expect(road(x, y)).toBe(false);
  });
});

describe("trainY", () => {
  it("comes in, waits at the platform, leaves, then stays gone", async () => {
    const { trainY } = await import("../src/client/forest.js");
    const [a, s, e] = [-500, 300, 900];
    expect(trainY(0, a, s, e)).toBe(a);
    expect(trainY(5, a, s, e)).toBe(s);
    expect(trainY(9, a, s, e)).toBe(s);
    expect(trainY(14, a, s, e)).toBeGreaterThan(s);
    expect(trainY(16, a, s, e)).toBe(e);
    expect(trainY(35, a, s, e)).toBe(e);
    expect(trainY(36, a, s, e)).toBe(a);
  });
});

describe("crossing gate", () => {
  it("is down while the train is at the road, up when it is far", async () => {
    const { gateClosed } = await import("../src/client/forest.js");
    expect(gateClosed(240)).toBe(true); // nose on the road
    expect(gateClosed(240 - 100)).toBe(true); // tail still on it
    expect(gateClosed(1000)).toBe(false); // still far south
    expect(gateClosed(-400)).toBe(false); // gone north
  });

  it("holds a car at the stop line while down, but lets one already on the track clear it", async () => {
    const { holdAtGate, STOP_WEST, STOP_EAST } = await import("../src/client/forest.js");
    expect(holdAtGate(true, STOP_WEST - 0.02, 16.5, 1, STOP_WEST + 0.03)).toBe(true); // eastbound, would cross the line
    expect(holdAtGate(true, STOP_WEST - 3, 16.5, 1, STOP_WEST - 2.95)).toBe(false); // still far back: keeps rolling up
    expect(holdAtGate(true, STOP_WEST + 0.3, 16.5, 1, STOP_WEST + 0.35)).toBe(false); // already past it: clears the track
    expect(holdAtGate(true, STOP_EAST + 0.02, 15.5, -1, STOP_EAST - 0.03)).toBe(true); // westbound, other side
    expect(holdAtGate(false, STOP_WEST - 0.02, 16.5, 1, STOP_WEST + 0.03)).toBe(false); // barrier up
    expect(holdAtGate(true, STOP_WEST - 0.02, 5, 1, STOP_WEST + 0.03)).toBe(false); // another road
  });
});

describe("station passengers", () => {
  it("nobody walks through the station building", async () => {
    const { crowd } = await import("../src/client/forest.js");
    const bx = STATION.x * 16, by = STATION.y * 16;
    for (let c = 0; c < 36; c += 0.1) for (const p of crowd(c)) expect(p.x > bx + 1 && p.x < bx + 79 && p.y > by + 3 && p.y < by + 63).toBe(false);
  });
  it("people board while the train waits, and the platform is empty once it has left", async () => {
    const { crowd } = await import("../src/client/forest.js");
    expect(crowd(5.7).some((p) => p.x < -130)).toBe(true); // waiting for the doors
    expect(crowd(6.3).some((p) => p.x < -150)).toBe(true); // at the carriage doors
    for (const c of [12, 14, 16]) expect(crowd(c).some((p) => p.x < -135)).toBe(false);
  });
  it("someone is inside buying a ticket at some point (not seen), and others come in from the road", async () => {
    const { crowd } = await import("../src/client/forest.js");
    let seenRoadside = false;
    for (let c = 0; c < 36; c += 0.1) if (crowd(c).some((p) => p.y < 290 && p.x > -70 && p.x < -40)) seenRoadside = true;
    expect(seenRoadside).toBe(true);
  });
  it("people walk between the station and the city: leavers reach it, arrivers start from it", async () => {
    const { crowd } = await import("../src/client/forest.js");
    const inCity = (c: number) => crowd(c).filter((p) => p.x > -8);
    let leaving = false, arriving = false;
    for (let c = 0; c < 36; c += 0.1) for (const p of inCity(c)) (p.n < 3 ? (arriving = true) : (leaving = true));
    expect(arriving && leaving).toBe(true);
    // they go all the way to a house door on the west avenue (tile column 2, rows 22-25), not just to the city's edge
    const atDoor = (who: (n: number) => boolean) => { for (let c = 0; c < 36; c += 0.05) if (crowd(c).some((p) => who(p.n) && p.x > 32 && p.x < 64 && p.y > 345)) return true; return false; };
    expect(atDoor((n) => n < 3)).toBe(true);
    expect(atDoor((n) => n >= 3)).toBe(true);
  });
});

describe("main road at the beach", () => {
  it("stops in the sand: no road tile at or beyond the sea or the end of the sand", () => {
    const sandEnd = (y: number) => COLS + sandFrom(y) + 2;
    expect(plan.ground.some((g) => g.road && g.x >= sandEnd(g.y))).toBe(false);
    expect(plan.ground.some((g) => g.road && g.x >= COLS + 1 && g.y >= 15 && g.y <= 16)).toBe(true);
  });
});

describe("train clock", () => {
  it("counts the ms until the train next stands at the platform", () => {
    expect(msToNextStop(0)).toBe(5500);
    expect(msToNextStop(5.5)).toBe(0);
    expect(msToNextStop(6)).toBe(35500);
    expect(msToNextStop(36 + 1)).toBe(4500);
  });
  it("starts at 0 and exposes the station route", () => {
    expect(trainClock()).toBeGreaterThanOrEqual(0);
    expect(CITY_EDGE).toEqual({ x: 0, y: 16 });
    expect(STATION_ROUTE).toEqual([{ x: -4, y: 16 }, { x: -4, y: 19 }]);
  });
  it("the resort stands clear: no road, no sea, no beach prop, no tree or bush", () => {
    for (let y = RESORT.y; y < RESORT.y + RESORT.h; y++)
      for (let x = COLS + RESORT.dx; x < COLS + RESORT.dx + RESORT.w; x++) {
        expect(shownRoad(x, y), `${x},${y}`).toBe(false);
        expect(plan.sea.some((t) => t.x === x && t.y === y), `${x},${y}`).toBe(false);
        expect(plan.sand.find((t) => t.x === x && t.y === y)?.prop ?? null, `${x},${y}`).toBeNull();
        expect(plan.trees.some((t) => t.x === x && (t.y === y || t.y - 1 === y)), `${x},${y}`).toBe(false);
        expect(plan.bushes.some((t) => t.x === x && t.y === y), `${x},${y}`).toBe(false);
      }
  });
});
