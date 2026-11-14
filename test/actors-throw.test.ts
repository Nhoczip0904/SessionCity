// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { Actors } from "../src/client/actors.js";
import { buildCity, TILE } from "../src/client/city.js";
import { nearestWalkable } from "../src/client/roads.js";
import type { Session } from "../src/shared/types.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

const z = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const session: Session = {
  id: "s1", project: "proj", cwd: "", lastActivity: "2026-01-01T00:00:00Z", status: "waiting", district: "townhall",
  tokens: { ...z, byModel: {} }, employees: [],
};

describe("nearestWalkable", () => {
  const w = [[false, false, false], [false, false, true], [false, false, false]];
  it("keeps a walkable tile, and finds the closest one otherwise", () => {
    expect(nearestWalkable(w, { x: 2, y: 1 })).toEqual({ x: 2, y: 1 });
    expect(nearestWalkable(w, { x: 0, y: 0 })).toEqual({ x: 2, y: 1 });
    expect(nearestWalkable(w, { x: -5, y: 9 })).toEqual({ x: 2, y: 1 });
  });
});

describe("throwing a person", () => {
  const setup = (motion = false) => {
    const city = buildCity(null);
    const layer = new Container();
    const actors = new Actors(city, layer, () => Texture.WHITE, null, () => {}, () => {}, { motion, rand: () => 0.5 });
    actors.sync({ sessions: [session], employees: [] });
    for (let i = 0; i < 400; i++) actors.update(50);
    const mayor = layer.children.find((c) => c.children.some((k) => "text" in k && k.text === "proj")) as Container;
    return { city, actors, mayor };
  };
  const onTile = (m: Container, city: ReturnType<typeof buildCity>) => city.walkable[Math.round((m.y - 14) / TILE)]?.[Math.round((m.x - 8) / TILE)];

  it("grabbing empty ground picks nobody up", () => {
    const { actors, mayor } = setup();
    expect(actors.grab({ x: mayor.x + 200, y: mayor.y + 200 })).toBe(false);
  });

  it("a grabbed person follows the pointer and stops walking", () => {
    const { actors, mayor } = setup();
    expect(actors.grab({ x: mayor.x, y: mayor.y - 8 }, 0)).toBe(true);
    actors.carry({ x: 200, y: 150 }, 16);
    actors.update(500);
    expect(mayor.x).toBe(200);
    expect(mayor.y).toBeGreaterThan(140);
  });

  it("a flick lands them on a walkable tile, knocked over; a moment later they stand again", () => {
    const { city, actors, mayor } = setup();
    actors.grab({ x: mayor.x, y: mayor.y - 8 }, 0);
    actors.carry({ x: mayor.x + 40, y: mayor.y - 8 }, 20);
    actors.release(30);
    actors.update(300);
    for (let i = 0; i < 40; i++) actors.update(25); // flight over
    expect(onTile(mayor, city)).toBe(true);
    expect(Math.abs(mayor.children[0].rotation)).toBeCloseTo(Math.PI / 2);
    expect(mayor.children.some((k) => "text" in k && k.text === "Ối!" && k.visible)).toBe(true);
    for (let i = 0; i < 120; i++) actors.update(25);
    expect(mayor.children[0].rotation).toBe(0);
  });

  it("a throw far off the map lands on the nearest walkable tile", () => {
    const { city, actors, mayor } = setup();
    actors.grab({ x: mayor.x, y: mayor.y - 8 }, 0);
    actors.carry({ x: -900, y: -900 }, 16);
    actors.release(17);
    for (let i = 0; i < 80; i++) actors.update(25);
    expect(onTile(mayor, city)).toBe(true);
  });

  it("releasing after the pointer stood still drops them at the pointer, not further", () => {
    const { city, actors, mayor } = setup();
    const at = { x: mayor.x + 60, y: mayor.y - 8 };
    actors.grab({ x: mayor.x, y: mayor.y - 8 }, 0);
    actors.carry(at, 20);
    actors.release(500); // pointer stopped long ago: no speed left
    for (let i = 0; i < 80; i++) actors.update(25);
    const want = nearestWalkable(city.walkable, { x: Math.round((at.x - 8) / TILE), y: Math.round((at.y + 8 - 14) / TILE) });
    expect(mayor.x).toBe(want.x * TILE + 8);
    expect(mayor.y).toBe(want.y * TILE + 14);
  });

  it("letting go with nothing held does nothing", () => {
    const { actors } = setup();
    expect(() => actors.release(0)).not.toThrow();
  });

});

describe("cheering", () => {
  it("everyone near the session's door jumps for a moment, then stands as before", () => {
    const layer = new Container();
    const actors = new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: true, rand: () => 0.5 });
    actors.sync({ sessions: [{ ...session, status: "idle" }], employees: [] });
    for (let i = 0; i < 400; i++) actors.update(50);
    const mayor = layer.children.find((c) => c.children.some((k) => "text" in k && k.text === "proj")) as Container;
    actors.update(1);
    const base = mayor.y;
    actors.cheer("s1");
    actors.update(50);
    expect(mayor.y).toBeLessThan(base);
    actors.update(1400);
    actors.update(1);
    expect(mayor.y).toBe(base);
  });

  it("an unknown session cheers nobody and does not throw", () => {
    const actors = new Actors(buildCity(null), new Container(), () => Texture.WHITE, null, () => {}, () => {}, { motion: true, rand: () => 0.5 });
    expect(() => actors.cheer("nope")).not.toThrow();
  });
});
