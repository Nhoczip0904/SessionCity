// @vitest-environment happy-dom
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { Ruins } from "../src/client/blast.js";

const RECTS = [{ x: 100, y: 50, w: 80, h: 40 }];

describe("a rock on a building", () => {
  const setup = () => {
    const layer = new Container();
    return { layer, ruins: new Ruins(layer, RECTS) };
  };
  const labels = (c: Container) => c.children.map((k) => k.label);

  it("blows it up: blasts play and rubble covers the building, then it is rebuilt", () => {
    const { layer, ruins } = setup();
    expect(ruins.hit({ x: 120, y: 60 })).toBe(true);
    expect(labels(layer)).toContain("ruin");
    expect(labels(layer)).toContain("boom");
    ruins.update(500);
    expect(labels(layer).filter((l) => l === "boom").length).toBeGreaterThan(1); // more blasts follow
    ruins.update(5000);
    expect(labels(layer)).toContain("ruin");
    ruins.update(3000);
    expect(labels(layer)).not.toContain("ruin");
  });

  it("a miss hits nothing; a ruined building cannot blow up again until rebuilt", () => {
    const { ruins } = setup();
    expect(ruins.hit({ x: 10, y: 10 })).toBe(false);
    expect(ruins.hit({ x: 100, y: 50 })).toBe(true); // the corner still counts
    expect(ruins.hit({ x: 150, y: 70 })).toBe(false);
    ruins.update(9000);
    expect(ruins.hit({ x: 150, y: 70 })).toBe(true);
  });
});
