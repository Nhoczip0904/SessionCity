// @vitest-environment happy-dom
import { Container, Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { satellite } from "../src/client/satellite.js";

describe("satellite", () => {
  it("glides in and locks on first, fires once, then cleans up", () => {
    const parent = new Container();
    const onFire = vi.fn();
    satellite(parent, { x: 120, y: 300 }, onFire);
    Ticker.shared.update(500);
    Ticker.shared.update(1000); // still aiming
    expect(onFire).not.toHaveBeenCalled();
    for (let i = 1; i <= 60; i++) Ticker.shared.update(1000 + i * 100);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(parent.children.filter((c) => c.label !== "boom")).toHaveLength(0);
  });
});
