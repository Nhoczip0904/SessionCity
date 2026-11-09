import { describe, expect, it } from "vitest";
import { findPath } from "../src/client/path.js";

// '.' = walkable, '#' = wall; grid[y][x]
const grid = (rows: string[]) => rows.map((r) => [...r].map((c) => c === "."));

describe("findPath", () => {
  it("straight corridor", () => {
    expect(findPath(grid(["....."]), { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
    ]);
  });

  it("goes around a wall", () => {
    const p = findPath(grid(["...", "##.", "..."]), { x: 0, y: 0 }, { x: 0, y: 2 });
    expect(p).toEqual([
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 },
    ]);
  });

  it("unreachable → []", () => {
    expect(findPath(grid([".#."]), { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([]);
  });

  it("same point → []", () => {
    expect(findPath(grid(["..."]), { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  it("prefers shortest", () => {
    // right of the wall: 5 steps; left of it: 9
    const g = grid([
      ".......",
      ".####..",
      ".......",
    ]);
    const p = findPath(g, { x: 5, y: 0 }, { x: 5, y: 2 });
    expect(p).toHaveLength(2);
    expect(p.at(-1)).toEqual({ x: 5, y: 2 });
    const q = findPath(g, { x: 3, y: 0 }, { x: 4, y: 2 });
    expect(q).toHaveLength(5);
    // every step is a 4-neighbour move onto a walkable tile
    let prev = { x: 3, y: 0 };
    for (const s of q) {
      expect(Math.abs(s.x - prev.x) + Math.abs(s.y - prev.y)).toBe(1);
      expect(g[s.y][s.x]).toBe(true);
      prev = s;
    }
  });
});
