import { describe, expect, it } from "vitest";
import { Texture, TextureSource } from "pixi.js";
import * as tiles from "../src/client/tiles.js";
import { loadSheets, OUTFIT_CITIZEN, SHIRT_COLORS, TSHIRT, SHIRT, JACKET, SUIT } from "../src/client/tiles.js";

const frame = (t: Texture) => ({ x: t.frame.x, y: t.frame.y, w: t.frame.width, h: t.frame.height });

describe("loadSheets", () => {
  it("returns null when a sheet fails to load", async () => {
    expect(await loadSheets(() => Promise.reject(new Error("404")))).toBeNull();
  });

  it("cuts 16×16 frames from both sheets", async () => {
    const fake = () => Promise.resolve(new Texture({ source: new TextureSource({ width: 592, height: 448 }) }));
    const sheets = (await loadSheets(fake))!;
    expect(frame(sheets.city(38))).toEqual({ x: 16, y: 16, w: 16, h: 16 });
    expect(frame(sheets.char(2, 1))).toEqual({ x: 34, y: 17, w: 16, h: 16 });
  });

  it("cuts indoor frames with 1 px spacing", async () => {
    const fake = () => Promise.resolve(new Texture({ source: new TextureSource({ width: 458, height: 305 }) }));
    const sheets = (await loadSheets(fake))!;
    expect(frame(sheets.indoor!(28))).toEqual({ x: 17, y: 17, w: 16, h: 16 });
  });

  it("indoor sheet failing leaves city sheets usable", async () => {
    const load = (u: string) =>
      u.includes("roguelikeIndoor")
        ? Promise.reject(new Error("404"))
        : Promise.resolve(new Texture({ source: new TextureSource({ width: 592, height: 448 }) }));
    const sheets = await loadSheets(load);
    expect(sheets).not.toBeNull();
    expect(sheets!.indoor).toBeUndefined();
    expect(frame(sheets!.city(0)).w).toBe(16);
  });

  it("citizen shirt matches no staff outfit", () => {
    const taken = new Set<string>();
    for (const [cx, cy] of SHIRT_COLORS) for (const [dx, dy] of [TSHIRT, SHIRT, JACKET, SUIT]) taken.add(`${cx + dx},${cy + dy}`);
    for (const [k, o] of Object.entries(tiles)) if (k.startsWith("OUTFIT_") && k !== "OUTFIT_CITIZEN" && !(o as tiles.Outfit).own) taken.add((o as tiles.Outfit).shirt.join(","));
    expect(taken.has(OUTFIT_CITIZEN.shirt.join(","))).toBe(false);
  });
});
