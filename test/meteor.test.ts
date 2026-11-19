// @vitest-environment happy-dom
import { Container, Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { meteor } from "../src/client/meteor.js";

describe("meteor", () => {
  it("falls first, lands once with area blast, then cleans up", () => {
    const parent = new Container();
    const onLand = vi.fn();
    meteor(parent, { x: 120, y: 200 }, onLand);
    expect(onLand).not.toHaveBeenCalled();
    for (let i = 1; i <= 40; i++) Ticker.shared.update(i * 100);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(parent.children.filter((c) => c.label !== "boom")).toHaveLength(0);
  });
});
