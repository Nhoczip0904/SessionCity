// @vitest-environment happy-dom
import { CanvasTextMetrics, Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { Actors, QUIPS } from "../src/client/actors.js";
import { buildCity } from "../src/client/city.js";

vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

const texts = (c: Container) => c.children.filter((k) => "text" in k) as unknown as { text: string; visible: boolean }[];

describe("mascot Tín", () => {
  const setup = () => {
    const layer = new Container();
    const actors = new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: false, rand: () => 0.5 });
    const tin = layer.children.find((c) => texts(c as Container).some((t) => t.text === "Tín")) as Container;
    return { actors, tin };
  };

  it("lives in the city with his name always showing", () => {
    const { tin } = setup();
    expect(tin).toBeDefined();
    expect(texts(tin).find((t) => t.text === "Tín")!.visible).toBe(true);
  });

  it("says a line when clicked, then goes quiet", () => {
    const { actors, tin } = setup();
    tin.emit("pointertap", {} as never);
    expect(texts(tin).some((t) => QUIPS.includes(t.text) && t.visible)).toBe(true);
    actors.update(3000);
    expect(texts(tin).some((t) => QUIPS.includes(t.text) && t.visible)).toBe(false);
  });
});

describe("mascot Tín look", () => {
  it("wears shades and a cape over his figure", () => {
    const layer = new Container();
    new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: false, rand: () => 0.5 });
    const tin = layer.children.find((c) => texts(c as Container).some((t) => t.text === "Tín")) as Container;
    const fig = tin.children[0] as Container;
    expect(fig.children.some((k) => k.label === "shades")).toBe(true);
    expect(fig.children.length).toBe(4);
  });
});

describe("named NPCs Quang, Huy, Đạt", () => {
  it("walk the city with gold names, greet by name, and wear no cape", () => {
    const layer = new Container();
    new Actors(buildCity(null), layer, () => Texture.WHITE, null, () => {}, () => {}, { motion: false, rand: () => 0.5 });
    for (const name of ["Quang", "Huy", "Đạt"]) {
      const npc = layer.children.find((c) => texts(c as Container).some((t) => t.text === name)) as Container;
      expect(npc).toBeDefined();
      expect(texts(npc).find((t) => t.text === name)!.visible).toBe(true);
      npc.emit("pointertap", {} as never);
      expect(texts(npc).some((t) => t.text === `Chào bạn! Mình là ${name} 🐾` && t.visible)).toBe(true);
      expect((npc.children[0] as Container).children.some((k) => k.label === "shades")).toBe(false);
    }
  });
});

describe("park benches", () => {
  it("someone walks in and sits on a bench, below the pavement tile they walked to", () => {
    let n = 7;
    const rand = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
    const city = buildCity(null);
    const actors = new Actors(city, new Container(), () => Texture.WHITE, null, () => {}, () => {}, { motion: true, rand });
    type Seen = { sit?: number; tx: number; ty: number; c: Container };
    const all = () => (actors as unknown as { citizens: Seen[] }).citizens;
    let sitter: Seen | undefined;
    for (let t = 0; t < 600_000 && !sitter; t += 100) { actors.update(100); sitter = all().find((a) => a.sit !== undefined); }
    expect(sitter).toBeDefined();
    actors.update(1);
    expect(city.seats.some((s) => s.x === sitter!.tx && s.y === sitter!.ty)).toBe(true);
    expect(sitter!.c.y).toBeGreaterThan((sitter!.ty + 1) * 16);
    expect(city.walkable[sitter!.ty + 1]![sitter!.tx]).toBe(false); // the bench itself is not a street tile
  });
});
