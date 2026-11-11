import { describe, expect, it } from "vitest";
import { restTarget } from "../src/client/actors.js";

const grid = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => x === 10 || y === 10));

describe("restTarget", () => {
  it("without wander is home", () => {
    expect(restTarget({ x: 10, y: 4 }, false, grid, Math.random)).toEqual({ x: 10, y: 4 });
  });
  it("with wander stays within 3 of home on a road", () => {
    const home = { x: 10, y: 8 };
    for (let i = 0; i < 500; i++) {
      const t = restTarget(home, true, grid, Math.random);
      expect(grid[t.y][t.x]).toBe(true);
      expect(Math.abs(t.x - home.x) + Math.abs(t.y - home.y)).toBeLessThanOrEqual(3);
    }
  });
});
