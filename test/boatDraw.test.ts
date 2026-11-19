import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { BOATS, drawBoat } from "../src/client/boats.js";

const bounds = (t: number, d: number) => {
  const g = new Graphics();
  drawBoat(g, BOATS[0]!, 100, 100, d, t);
  return g.getLocalBounds();
};

describe("drawBoat", () => {
  it("draws a boat, wake and shadow around its centre", () => {
    const b = bounds(0, 1);
    expect(b.width).toBeGreaterThan(12);
    expect(b.height).toBeGreaterThan(24);
    expect(b.minX).toBeLessThan(100);
    expect(b.maxX).toBeGreaterThan(100);
  });
  it("the wake trails behind: below the boat upstream, above it downstream", () => {
    expect(bounds(0, 1).minY).toBeLessThan(bounds(0, -1).minY);
    expect(bounds(0, -1).maxY).toBeGreaterThan(bounds(0, 1).maxY);
  });
  it("sails and flag stir over time", () => {
    const shape = (t: number) => {
      const g = new Graphics();
      drawBoat(g, BOATS[0]!, 100, 100, 1, t);
      return JSON.stringify(g.context.instructions.map((i) => (i.data as { path?: { shapePath?: { shapePrimitives?: unknown[] } } }).path?.shapePath?.shapePrimitives));
    };
    expect(new Set([0, 300, 700, 1100, 1500].map(shape)).size).toBeGreaterThan(1);
  });
});
