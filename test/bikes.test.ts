// @vitest-environment happy-dom
import { Container, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { Traffic } from "../src/client/traffic.js";

const sheets = { city: () => Texture.WHITE, char: () => Texture.WHITE } as never;

describe("cyclists", () => {
  const setup = () => {
    const layer = new Container();
    let seed = 5;
    const traffic = new Traffic(layer, sheets, () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648));
    const all = layer.children.filter((c) => c.label !== "boom");
    return { layer, traffic, cars: all.slice(0, 9), bikes: all.slice(9) };
  };

  it("four bikes ride the road beside the nine cars, and keep moving", () => {
    const { traffic, bikes } = setup();
    expect(bikes).toHaveLength(4);
    const before = bikes.map((b) => `${b.x},${b.y}`);
    traffic.update(3000);
    expect(bikes.map((b) => `${b.x},${b.y}`)).not.toEqual(before);
  });

  it("a bike is slower than a car", () => {
    const { traffic, cars, bikes } = setup();
    const dist = (l: Container[]) => {
      const p = l.map((c) => [c.x, c.y]);
      traffic.update(1000);
      return l.reduce((s, c, i) => s + Math.hypot(c.x - p[i][0], c.y - p[i][1]), 0) / l.length;
    };
    const car = dist(cars), bike = dist(bikes);
    expect(bike).toBeLessThan(car);
  });

  it("a rock knocks the cyclist off; a new one turns up later", () => {
    const { traffic, bikes } = setup();
    const b = bikes[0];
    expect(traffic.hit({ x: b.x, y: b.y })).toBe(true);
    expect(b.visible).toBe(false);
    traffic.update(4500);
    expect(b.visible).toBe(true);
  });
});
