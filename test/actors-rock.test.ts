// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { Actors } from "../src/client/actors.js";
import { buildCity } from "../src/client/city.js";
import type { Session } from "../src/shared/types.js";

// happy-dom has no canvas text measuring
vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

const z = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const session: Session = {
  id: "s1", project: "proj", cwd: "", lastActivity: "2026-01-01T00:00:00Z", status: "waiting", district: "townhall",
  tokens: { ...z, byModel: {} }, employees: [],
};

describe("a rock hit", () => {
  const setup = () => {
    const layer = new Container();
    const actors = new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: false, rand: () => 0.5 });
    actors.sync({ sessions: [session], employees: [] });
    for (let i = 0; i < 400; i++) actors.update(50); // walk to the town hall door and stand there
    const mayor = layer.children.find((c) => c.children.some((k) => "text" in k && k.text === "proj")) as Container;
    return { actors, mayor };
  };

  it("knocks the person over with an Ối!, and they get up after a moment", () => {
    const { actors, mayor } = setup();
    const fig = mayor.children[0];
    expect(actors.hit({ x: mayor.x, y: mayor.y - 8 })).toBe(true);
    expect(Math.abs(fig.rotation)).toBeCloseTo(Math.PI / 2);
    expect(mayor.children.some((k) => "text" in k && k.text === "Ối!" && k.visible)).toBe(true);
    actors.update(1000);
    expect(Math.abs(fig.rotation)).toBeCloseTo(Math.PI / 2); // still down
    actors.update(600);
    expect(fig.rotation).toBe(0);
    expect(mayor.children.some((k) => "text" in k && k.text === "Ối!" && k.visible)).toBe(false);
  });

  it("a rock on empty ground hits nobody", () => {
    const { actors, mayor } = setup();
    expect(actors.hit({ x: mayor.x + 200, y: mayor.y + 200 })).toBe(false);
    expect(mayor.children[0].rotation).toBe(0);
  });
});
