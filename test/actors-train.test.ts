// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { Actors } from "../src/client/actors.js";
import { buildCity } from "../src/client/city.js";
import { CITY_EDGE, STATION_ROUTE, msToNextStop, trainClock } from "../src/client/forest.js";
import type { Session, State } from "../src/shared/types.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

type M = { c: Container; inside?: number; path: unknown[]; tx: number; ty: number };
const sess = (status: Session["status"]): State => ({
  sessions: [{ id: "s1", project: "p", cwd: "/p", lastActivity: "", status, district: "lab", tokens: {}, employees: [] } as unknown as Session],
  employees: [],
});
const setup = (motion = true) => {
  const city = buildCity(null);
  const actors = new Actors(city, new Container(), () => Texture.WHITE, null, () => {}, () => {}, { motion, rand: () => 0.5 });
  const mayor = () => (actors as unknown as { mayors: Map<string, M> }).mayors.get("s1")!;
  const run = (ms: number) => { for (let t = 0; t < ms; t += 100) actors.update(100); };
  return { city, actors, mayor, run };
};

describe("mayors leave and return by train", () => {
  it("idle session: mayor walks out then hides", () => {
    const { actors, mayor, run } = setup();
    actors.sync(sess("working"));
    run(20_000);
    actors.sync(sess("idle"));
    run(60_000);
    expect(mayor().c.visible).toBe(false);
    expect(mayor().inside).toBe(Infinity);
  });

  it("idle then working while walking out returns home", () => {
    const { city, actors, mayor, run } = setup();
    actors.sync(sess("working"));
    run(20_000);
    actors.sync(sess("idle"));
    run(500);
    actors.sync(sess("working"));
    run(60_000);
    const door = city.doors.lab!;
    expect(mayor().c.visible).toBe(true);
    expect(mayor().inside).toBeUndefined();
    expect(Math.hypot(mayor().tx - door.x, mayor().ty - door.y)).toBeLessThan(8); // a working mayor mills about near its door
  });

  it("a mayor thrown while leaving still walks to the station and hides there", () => {
    const { actors, mayor, run } = setup();
    actors.sync(sess("working"));
    run(20_000);
    actors.sync(sess("idle"));
    run(300);
    const m = mayor();
    expect(actors.grab({ x: m.c.x, y: m.c.y - 8 })).toBe(true);
    actors.release(1000);
    run(2_500); // lands, lies down, gets up
    expect(m.c.visible).toBe(true);
    expect(m.path.length).toBeGreaterThan(0);
    run(60_000);
    expect(m.c.visible).toBe(false);
    expect(m.tx).toBe(STATION_ROUTE[1]!.x);
  });

  it("away then working reappears at the next stop", () => {
    const { actors, mayor, run } = setup();
    actors.sync(sess("idle"));
    actors.sync(sess("working"));
    expect(mayor().c.visible).toBe(false);
    run(msToNextStop(trainClock()) + 100);
    expect(mayor().c.visible).toBe(true);
  });

  it("session idle at first sync starts hidden at the station", () => {
    const { actors, mayor } = setup();
    actors.sync(sess("idle"));
    expect(mayor().c.visible).toBe(false);
    expect(mayor().inside).toBe(Infinity);
    expect(mayor().path).toEqual([]);
    expect(mayor().tx).toBe(STATION_ROUTE[1]!.x);
  });

  it("session removed while away is destroyed", () => {
    const { actors, mayor } = setup();
    actors.sync(sess("idle"));
    const c = mayor().c;
    actors.sync({ sessions: [], employees: [] });
    expect(c.destroyed).toBe(true);
  });

  it("motion false keeps old behaviour", () => {
    const { city, actors, mayor, run } = setup(false);
    actors.sync(sess("idle"));
    run(30_000);
    expect(mayor().c.visible).toBe(true);
    expect(Math.round(mayor().tx)).toBe(city.doors.lab!.x);
  });

  it("CITY_EDGE is walkable", () => {
    expect(buildCity(null).walkable[CITY_EDGE.y]![CITY_EDGE.x]).toBe(true);
  });
});
