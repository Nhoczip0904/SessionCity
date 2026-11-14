import { describe, expect, it } from "vitest";
import { BOATS, boatPos, underBridge } from "../src/client/boats.js";

const ROWS = 43;
const left = (y: number) => (y < 10 ? 29 : 31); // a bend, enough to test following
const at = (i: number, t: number) => boatPos(BOATS[i]!, t, left, ROWS);

describe("boats", () => {
  it("2-3 boats, in different lanes", () => {
    expect(BOATS.length).toBeGreaterThanOrEqual(2);
    expect(BOATS.length).toBeLessThanOrEqual(3);
    expect(new Set(BOATS.map((b) => b.lane)).size).toBe(BOATS.length);
  });

  it("stays inside the 3-wide river, also across the bend, at any time", () => {
    for (let i = 0; i < BOATS.length; i++)
      for (let t = 0; t < 400_000; t += 997) {
        const p = at(i, t);
        const a = left(Math.floor(p.y)), b = left(Math.floor(p.y) + 1);
        expect(p.x).toBeGreaterThan(Math.min(a, b));
        expect(p.x).toBeLessThan(Math.max(a, b) + 3);
      }
  });

  it("drifts along the river, then comes round again (wraps)", () => {
    const ys = Array.from({ length: 200 }, (_, k) => at(0, k * 2000).y);
    expect(ys.some((y, k) => k && y !== ys[k - 1])).toBe(true);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(ROWS + 1);
    expect(ys.some((y, k) => k && Math.abs(y - ys[k - 1]!) > ROWS / 2)).toBe(true);
  });

  it("goes both ways: at least one boat upstream, one downstream", () => {
    expect(BOATS.some((b) => b.speed > 0)).toBe(true);
    expect(BOATS.some((b) => b.speed < 0)).toBe(true);
  });

  it("is hidden while under the bridge (rows 15-16)", () => {
    expect(underBridge(15.5)).toBe(true);
    expect(underBridge(16.9)).toBe(true);
    expect(underBridge(14.2)).toBe(false);
    expect(underBridge(17.6)).toBe(false);
  });
});
