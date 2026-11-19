// @vitest-environment happy-dom
import { Container, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { Traffic } from "../src/client/traffic.js";

const sheets = { city: () => Texture.WHITE, char: () => Texture.WHITE } as never;

describe("a rock on a car", () => {
  const setup = () => {
    const layer = new Container();
    let seed = 3;
    const traffic = new Traffic(layer, sheets, () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648));
    const cars = layer.children.filter((c) => c.label !== "boom");
    return { layer, traffic, car: cars[0] };
  };

  it("blows it up: the car is gone, a blast plays, and a new car turns up a few seconds later", () => {
    const { layer, traffic, car } = setup();
    expect(traffic.hit({ x: car.x, y: car.y })).toBe(true);
    expect(car.visible).toBe(false);
    expect(layer.children.some((c) => c.label === "boom")).toBe(true);
    traffic.update(2000);
    expect(car.visible).toBe(false);
    traffic.update(2500);
    expect(car.visible).toBe(true);
  });

  it("with a radius, every car inside it is wrecked, none outside", () => {
    const { traffic, layer } = setup();
    const cars = layer.children.filter((c) => c.label !== "boom");
    const [a, b] = cars as [Container, Container];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(traffic.hit({ x: a.x, y: a.y }, 0.5)).toBe(true);
    expect(a.visible).toBe(false);
    if (d > 0.5) expect(b.visible).toBe(true);
    expect(traffic.hit({ x: a.x, y: a.y }, d + 1)).toBe(true); // wide enough for b too
    expect(b.visible).toBe(false);
  });

  it("a rock on empty road hits no car; a wrecked car cannot be hit again", () => {
    const { traffic, car } = setup();
    expect(traffic.hit({ x: -500, y: -500 })).toBe(false);
    traffic.hit({ x: car.x, y: car.y });
    expect(car.visible).toBe(false);
    expect(traffic.hit({ x: car.x, y: car.y })).toBe(false);
  });
});
