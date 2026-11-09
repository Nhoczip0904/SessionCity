import { describe, expect, it } from "vitest";
import { Texture, TextureSource } from "pixi.js";
import { loadSheets } from "../src/client/tiles.js";

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
});
