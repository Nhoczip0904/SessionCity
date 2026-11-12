// @vitest-environment happy-dom
import { Container, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { Traffic } from "../src/client/traffic.js";

const sheets = { city: () => Texture.WHITE } as never;

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

  it("a rock on empty road hits no car; a wrecked car cannot be hit again", () => {
    const { traffic, car } = setup();
    expect(traffic.hit({ x: -500, y: -500 })).toBe(false);
    traffic.hit({ x: car.x, y: car.y });
    expect(car.visible).toBe(false);
    expect(traffic.hit({ x: car.x, y: car.y })).toBe(false);
  });
});
