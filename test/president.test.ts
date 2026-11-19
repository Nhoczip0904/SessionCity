// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { Actors } from "../src/client/actors.js";
import { buildCity } from "../src/client/city.js";
import type { Session } from "../src/shared/types.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

const z = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const mk = (id: string, project: string): Session => ({ id, project, cwd: "", lastActivity: "2026-01-01T00:00:00Z", status: "idle", district: "townhall", tokens: { ...z, byModel: {} }, employees: [] });
const label = (layer: Container, id: string) => layer.children.flatMap((c) => (c as Container).children).filter((k) => "text" in k).map((k) => (k as unknown as { text: string }).text).find((t) => t.includes(id));

describe("president", () => {
  const setup = () => {
    const layer = new Container();
    const actors = new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: false, rand: () => 0.5 });
    actors.sync({ sessions: [mk("a", "alpha"), mk("b", "beta")], employees: [] });
    return { layer, actors };
  };

  it("appointing a session marks only its mayor, and a new one replaces the old", () => {
    const { layer, actors } = setup();
    actors.setPresident("a");
    expect(label(layer, "alpha")).toBe("★ alpha");
    expect(label(layer, "beta")).toBe("beta");
    actors.setPresident("b");
    expect(label(layer, "alpha")).toBe("alpha");
    expect(label(layer, "beta")).toBe("★ beta");
    actors.setPresident(null);
    expect(label(layer, "beta")).toBe("beta");
  });

  it("the mark survives the next sync", () => {
    const { layer, actors } = setup();
    actors.setPresident("a");
    actors.sync({ sessions: [mk("a", "alpha"), mk("b", "beta")], employees: [] });
    expect(label(layer, "alpha")).toBe("★ alpha");
  });
});
