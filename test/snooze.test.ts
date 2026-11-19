// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Text } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { snooze } from "../src/client/snooze.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 5, height: 8, lines: [""], lineWidths: [5], lineHeight: 8, maxLineWidth: 5, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

const zs = (c: Container) => c.children.filter((k): k is Text => k instanceof Text);

describe("snooze", () => {
  it("a z drifts up from the sleeper's head and fades, then starts over", () => {
    const root = new Container();
    const step = snooze(root, [{ x: 20, y: 50 }]);
    const [z] = zs(root);
    step(100);
    const y0 = z.y, a0 = z.alpha;
    step(1000);
    expect(z.y).toBeLessThan(y0);
    expect(z.alpha).toBeLessThan(a0);
    step(1500); // past the 2400 ms cycle
    expect(z.y).toBeGreaterThan(y0 - 14);
    expect(z.alpha).toBeGreaterThan(0.5);
  });
  it("the sleeper's body rises and falls with the breath", () => {
    const fig = new Container();
    const step = snooze(new Container(), [{ x: 0, y: 0, fig }]);
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) { step(150); seen.add(fig.scale.y); }
    expect(seen.size).toBeGreaterThan(5);
    expect(Math.min(...seen)).toBeGreaterThan(0.95);
    expect(Math.max(...seen)).toBeLessThan(1.1);
  });
  it("nobody asleep: nothing is added", () => {
    const root = new Container();
    snooze(root, [])(1000);
    expect(root.children).toHaveLength(0);
  });
  it("sleepers do not all snore in step", () => {
    const root = new Container();
    snooze(root, [{ x: 0, y: 0 }, { x: 30, y: 0 }])(500);
    const [a, b] = zs(root);
    expect(a.y).not.toBe(b.y);
  });
});
