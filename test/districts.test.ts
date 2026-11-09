import { describe, expect, it } from "vitest";
import { DISTRICTS, districtInfo } from "../src/shared/districts.js";

describe("districts", () => {
  it("every district has sign, description, examples", () => {
    expect(DISTRICTS).toHaveLength(11);
    expect(new Set(DISTRICTS.map((d) => d.id)).size).toBe(11);
    for (const d of DISTRICTS) {
      expect(d.sign).not.toBe("");
      expect(d.description).not.toBe("");
      expect(Array.isArray(d.examples)).toBe(true);
    }
  });
  it("Phòng thí nghiệm sign is 'Chạy test'", () => expect(districtInfo("lab").sign).toBe("Chạy test"));
});
