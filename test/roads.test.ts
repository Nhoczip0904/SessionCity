import { describe, expect, it } from "vitest";
import { carPos, nextNode, roadGraph, spawnCar, stepCar, gapAhead, inLane, wanderTarget } from "../src/client/roads.js";

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const XS = [3, 16, 32, 45], YS = [3, 16, 29];
// the old full grid as 2-wide road rectangles; centre lines at XS x YS
const GRID = [
  ...[2, 15, 28].map((y) => ({ x: 2, y, w: 44, h: 2 })),
  ...[2, 15, 31, 44].map((x) => ({ x, y: 2, w: 2, h: 28 })),
];

describe("roads", () => {
  it("a full grid has 4×3 intersections", () => {
    const g = roadGraph(GRID);
    expect(g.nodes.length).toBe(12);
    const at = (x: number, y: number) => g.nodes.findIndex((n) => n.x === x && n.y === y);
    expect(g.adj[at(3, 3)].length).toBe(2);
    expect(g.adj[at(16, 16)].length).toBe(4);
  });

  it("nextNode never turns back when there is a choice", () => {
    const g = roadGraph(GRID), rand = mulberry32(1);
    g.adj.forEach((nb, at) => nb.forEach((from) => {
      for (let i = 0; i < 200; i++) {
        const n = nextNode(g, at, from, rand);
        expect(nb).toContain(n);
        if (nb.length > 1) expect(n).not.toBe(from);
      }
    }));
  });

  it("dead end turns back", () => {
    const g = roadGraph([{ x: 0, y: 0, w: 2, h: 6 }]);
    expect(g.nodes).toEqual([{ x: 1, y: 1 }, { x: 1, y: 5 }]);
    expect(nextNode(g, 1, 0, mulberry32(2))).toBe(0);
  });

  it("T-junctions and dead ends become nodes; offset side streets do not cross", () => {
    // main road rows 4-5, a street up from it at cols 2-3 and one down at cols 8-9
    const g = roadGraph([{ x: 0, y: 4, w: 12, h: 2 }, { x: 2, y: 0, w: 2, h: 6 }, { x: 8, y: 4, w: 2, h: 6 }]);
    const at = (x: number, y: number) => g.nodes.findIndex((n) => n.x === x && n.y === y);
    expect(g.nodes.length).toBe(6);
    expect(g.adj[at(3, 5)].sort()).toEqual([at(1, 5), at(3, 1), at(9, 5)].sort());
    expect(g.adj[at(9, 5)].sort()).toEqual([at(3, 5), at(9, 9), at(11, 5)].sort());
  });

  it("cars stay on centre lines", () => {
    const g = roadGraph(GRID), rand = mulberry32(3);
    const cars = Array.from({ length: 6 }, () => spawnCar(g, rand));
    for (let s = 0; s < 5000; s++) for (const c of cars) {
      stepCar(g, c, 16, rand);
      const p = carPos(g, c);
      expect(XS.includes(p.x) || YS.includes(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(3 - 1e-9); expect(p.x).toBeLessThanOrEqual(45 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(3 - 1e-9); expect(p.y).toBeLessThanOrEqual(29 + 1e-9);
      expect(c.speed).toBeGreaterThanOrEqual(0.002); expect(c.speed).toBeLessThanOrEqual(0.004);
    }
  });

  it("wanderTarget stays near the door on a road", () => {
    const rand = mulberry32(4);
    const w = Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) => y === 4 || x === 4));
    const door = { x: 4, y: 4 };
    for (let i = 0; i < 500; i++) {
      const p = wanderTarget(w, door, 3, rand);
      expect(w[p.y][p.x]).toBe(true);
      expect(Math.abs(p.x - 4) + Math.abs(p.y - 4)).toBeLessThanOrEqual(3);
    }
    const none = w.map((r) => r.map(() => false));
    expect(wanderTarget(none, door, 3, rand)).toEqual(door);
  });
});

describe("lanes and spacing", () => {
  it("cars keep to the right of the centre line (screen y down)", () => {
    expect(inLane({ x: 3, y: 3, dx: 1, dy: 0 })).toMatchObject({ x: 3, y: 3.5 }); // east → lower lane
    expect(inLane({ x: 3, y: 3, dx: -1, dy: 0 })).toMatchObject({ x: 3, y: 2.5 }); // west → upper lane
    expect(inLane({ x: 3, y: 3, dx: 0, dy: -1 })).toMatchObject({ x: 3.5, y: 3 }); // north → right lane
  });
  it("gapAhead sees only the car in front in the same lane", () => {
    const me = { x: 0, y: 0.5, dx: 1, dy: 0 };
    expect(gapAhead(me, [{ x: 1.5, y: 0.5 }])).toBeCloseTo(1.5);
    expect(gapAhead(me, [{ x: -1, y: 0.5 }])).toBe(Infinity); // behind
    expect(gapAhead(me, [{ x: 1, y: -0.5 }])).toBe(Infinity); // oncoming lane
    expect(gapAhead(me, [{ x: 3, y: 0.5 }, { x: 2, y: 0.6 }])).toBeCloseTo(2);
  });
  it("wanderTarget skips taken tiles and falls back to the door", () => {
    const w = [[true, true, true]];
    const rand = () => 0;
    expect(wanderTarget(w, { x: 1, y: 0 }, 1, rand, (p) => p.x === 0)).toEqual({ x: 1, y: 0 });
    expect(wanderTarget(w, { x: 1, y: 0 }, 1, rand, () => true)).toEqual({ x: 1, y: 0 });
  });
});
