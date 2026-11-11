// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { CanvasTextMetrics, Container, EventBoundary, Texture, FederatedPointerEvent } from "pixi.js";
import "pixi.js/events";
import { drawRoom, fitBoard } from "../src/client/roomDraw.js";
import { OFFICE_THEME } from "../src/client/rooms.js";

function tap(boundary: EventBoundary, x: number, y: number) {
  for (const type of ["pointerdown", "pointerup"] as const) {
    const e = new FederatedPointerEvent(boundary);
    e.type = type;
    e.pointerType = "mouse";
    e.pointerId = 1;
    e.isPrimary = true;
    e.button = 0;
    e.global.set(x, y);
    e.nativeEvent = { type } as never;
    boundary.mapEvent(e);
  }
}

// happy-dom has no canvas text measuring; hit testing only needs some bounds
vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({ width: 20, height: 8, lines: [""], lineWidths: [20], lineHeight: 8, maxLineWidth: 20, fontProperties: { ascent: 6, descent: 2, fontSize: 8 }, text: "", style: {} } as never);

describe("room taps without a preceding hover (Pixi hit testing)", () => {
  it("furniture and seats both get pointertap", () => {
    const onFurniture = vi.fn(), onPick = vi.fn();
    const root = new Container();
    root.addChild(drawRoom({ indoor: () => Texture.WHITE } as never, OFFICE_THEME, [{ at: { x: 7, y: 3 }, big: true, fig: null, label: "x", badge: "", done: false, onPick }], ["a", "b", "c"], "note", onFurniture));
    const b = new EventBoundary(root);
    for (const [x, f] of [[1, "safe"], [2, "cabinet"], [3, "phone"], [5, "map"], [8, "shelf"]] as const) {
      tap(b, x * 16 + 8, 2 * 16 + 8);
      expect(onFurniture).toHaveBeenLastCalledWith(f);
    }
    tap(b, 8 * 16 + 8, 3 * 16 + 8);
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe("fitBoard", () => {
  it("keeps 3 lines and cuts long ones with an ellipsis", () => {
    const out = fitBoard(["a", "b".repeat(200), "c", "d"], 10);
    expect(out).toEqual(["a", "b".repeat(9) + "…", "c"]);
  });
});
