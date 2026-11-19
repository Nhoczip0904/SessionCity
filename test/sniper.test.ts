// @vitest-environment happy-dom
import { Container, Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { scope, shoot } from "../src/client/sniper.js";

describe("sniper", () => {
  it("a shot lands at once, then the tracer fades and goes", () => {
    const parent = new Container();
    const onLand = vi.fn();
    shoot(parent, { x: 0, y: 300 }, { x: 120, y: 200 }, onLand);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(1);
    for (let i = 1; i <= 10; i++) Ticker.shared.update(i * 100);
    expect(parent.children).toHaveLength(0);
  });

  it("the scope follows the pointer and hides on null", () => {
    const parent = new Container();
    const s = scope(parent);
    const g = parent.children[0]!;
    expect(g.visible).toBe(false);
    s.at({ x: 40, y: 50 });
    expect([g.visible, g.x, g.y]).toEqual([true, 40, 50]);
    s.at(null);
    expect(g.visible).toBe(false);
  });
});

describe("sniper tuning", () => {
  it("reloads fast and zooms in", async () => {
    const m = await import("../src/client/sniper.js");
    expect(m.RELOAD).toBeLessThanOrEqual(400);
    expect(m.ZOOM).toBeGreaterThan(1);
  });
});
