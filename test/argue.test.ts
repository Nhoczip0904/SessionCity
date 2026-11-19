// @vitest-environment happy-dom
import { CanvasTextMetrics, Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { LINES, argue } from "../src/client/argue.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

const shown = (c: Container) => c.children.filter((k) => "text" in k && k.visible && LINES.includes((k as { text: string }).text));

describe("argue", () => {
  it("someone at the table speaks, then goes quiet, then another speaks", () => {
    const root = new Container();
    const step = argue(root, [{ x: 10, y: 10 }, { x: 40, y: 10 }], () => 0.5);
    expect(shown(root)).toHaveLength(0);
    step(1900);
    expect(shown(root)).toHaveLength(1);
    step(2500);
    expect(shown(root)).toHaveLength(0);
    step(1900);
    expect(shown(root)).toHaveLength(1);
  });
  it("an empty table stays silent", () => {
    const root = new Container();
    argue(root, [], () => 0.5)(5000);
    expect(root.children.every((k) => !("text" in k) || !k.visible)).toBe(true);
  });
});
