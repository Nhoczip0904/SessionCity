// @vitest-environment happy-dom
import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { decorUnder } from "../src/client/roomDecor.js";
import { ROOM_THEMES } from "../src/client/rooms.js";
import * as K from "../src/client/tiles.js";

describe("construction site", () => {
  it("room is no longer stocked with warehouse crates and barrels", () => {
    const tiles = ROOM_THEMES.site!.props.flatMap((p) => p.tiles);
    expect(tiles).not.toContain(K.CRATE);
    expect(tiles).not.toContain(K.BARREL);
  });
  it("worksite decor draws a brick wall and studs", () => {
    let fn: ((g: Graphics, t: number) => void) | undefined;
    decorUnder("worksite", ((f: typeof fn) => void (fn = f)) as never);
    const g = new Graphics();
    fn!(g, 0);
    expect(g.context.instructions.length).toBeGreaterThan(20);
  });
});
