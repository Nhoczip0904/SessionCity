import { describe, expect, it } from "vitest";
import { stampDown } from "../src/client/paperwork.js";

describe("stampDown", () => {
  it("is up for most of the cycle and comes down once, at the end", () => {
    expect(stampDown(0, 0)).toBe(0);
    expect(stampDown(3600, 0)).toBeCloseTo(0);
    expect(stampDown(3800, 0)).toBeCloseTo(1);
    expect(stampDown(4000, 0)).toBeCloseTo(0);
  });
  it("neighbours stamp at different moments (phase)", () => {
    expect(stampDown(3800, 4)).toBe(0);
  });
});
