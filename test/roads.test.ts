import { describe, expect, it } from "vitest";
import { carPos, centreLines, nextNode, roadGraph, spawnCar, stepCar, wanderTarget } from "../src/client/roads.js";

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const XS = [3, 16, 32, 45], YS = [3, 16, 29];

describe("roads", () => {
  it("centreLines picks the second index of each 2-tile road", () => {
    expect(centreLines([2, 3, 15, 16])).toEqual([3, 16]);
  });

  it("city graph has 4×3 intersections", () => {
    const g = roadGraph(XS, YS);
    expect(g.nodes.length).toBe(12);
    const at = (x: number, y: number) => g.nodes.findIndex((n) => n.x === x && n.y === y);
    expect(g.adj[at(3, 3)].length).toBe(2);
    expect(g.adj[at(16, 16)].length).toBe(4);
  });

  it("nextNode never turns back when there is a choice", () => {
    const g = roadGraph(XS, YS), rand = mulberry32(1);
    g.adj.forEach((nb, at) => nb.forEach((from) => {
      for (let i = 0; i < 200; i++) {
        const n = nextNode(g, at, from, rand);
        expect(nb).toContain(n);
        if (nb.length > 1) expect(n).not.toBe(from);
      }
    }));
  });

  it("dead end turns back", () => {
    const g = roadGraph([0], [0, 5]);
    expect(nextNode(g, 1, 0, mulberry32(2))).toBe(0);
  });

  it("cars stay on centre lines", () => {
    const g = roadGraph(XS, YS), rand = mulberry32(3);
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
