// @vitest-environment happy-dom
import { Container, Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { strike } from "../src/client/lightning.js";

describe("strike", () => {
  it("lands at once where it was aimed, flashes, then fades and cleans up", () => {
    const parent = new Container();
    const onLand = vi.fn();
    strike(parent, { x: 120, y: 200 }, onLand);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(1);
    for (let i = 1; i <= 20; i++) Ticker.shared.update(i * 100);
    expect(parent.children).toHaveLength(0);
    expect(onLand).toHaveBeenCalledTimes(1);
  });
});
