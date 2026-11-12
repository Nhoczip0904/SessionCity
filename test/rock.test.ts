import { describe, expect, it } from "vitest";
import { nearestHit } from "../src/client/rock.js";

describe("nearestHit", () => {
  // people stand with their feet at (x, y); the body goes up about 16 px
  const people = [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 300, y: 300 }];
  it("a rock on someone's body hits them", () => {
    expect(nearestHit(people, { x: 101, y: 92 })).toBe(0);
    expect(nearestHit(people, { x: 139, y: 99 })).toBe(1);
  });
  it("the closest one wins when two are in reach", () => {
    expect(nearestHit([{ x: 100, y: 100 }, { x: 108, y: 100 }], { x: 106, y: 94 })).toBe(1);
  });
  it("a rock on empty ground hits nobody", () => {
    expect(nearestHit(people, { x: 200, y: 200 })).toBe(-1);
    expect(nearestHit([], { x: 0, y: 0 })).toBe(-1);
  });
  it("reach is about a body: just above the head still counts, far above does not", () => {
    expect(nearestHit(people, { x: 100, y: 84 })).toBe(0);
    expect(nearestHit(people, { x: 100, y: 70 })).toBe(-1);
  });
});
