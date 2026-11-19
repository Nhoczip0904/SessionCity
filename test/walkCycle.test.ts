import { describe, expect, it } from "vitest";
import { FRAMES, FRAME_AT, WALK_FRAMES, walkFrame } from "../src/client/walkCycle.js";

// 16x16 figure: opaque head at (8,3), arms at (1,9) and (14,9), legs at (6,14) and (9,14).
const W = 16;
const fig = () => {
  const d = new Uint8ClampedArray(W * W * 4);
  for (const [x, y] of [[8, 3], [1, 9], [14, 9], [6, 14], [9, 14]]) d[(y * W + x) * 4 + 3] = 255;
  return d;
};
const on = (d: Uint8ClampedArray) => {
  const s = new Set<string>();
  for (let i = 0; i < W * W; i++) if (d[i * 4 + 3]) s.add(`${i % W},${Math.floor(i / W)}`);
  return s;
};

describe("walk cycle", () => {
  it("has 4 frames and keeps every pixel", () => {
    expect(WALK_FRAMES).toBe(4);
    for (let k = 0; k < WALK_FRAMES; k++) expect(on(walkFrame(fig(), W, W, k)).size).toBe(5);
  });

  it("legs scissor apart and together while the feet stay on the ground", () => {
    const f0 = on(walkFrame(fig(), W, W, 0));
    const f1 = on(walkFrame(fig(), W, W, 1));
    const f2 = on(walkFrame(fig(), W, W, 2));
    expect(f0.has("5,14") && f0.has("10,14")).toBe(true); // apart
    expect(f1.has("6,14") && f1.has("9,14")).toBe(true); // together
    expect(f2.has("7,14") && f2.has("8,14")).toBe(true); // crossed
  });

  it("the body bobs on the passing frames and the arms swing against each other", () => {
    expect(on(walkFrame(fig(), W, W, 0)).has("8,3")).toBe(true);
    expect(on(walkFrame(fig(), W, W, 1)).has("8,2")).toBe(true);
    const a0 = on(walkFrame(fig(), W, W, 0));
    expect(a0.has("1,10") && a0.has("14,8")).toBe(true);
    const a2 = on(walkFrame(fig(), W, W, 2));
    expect(a2.has("1,8") && a2.has("14,10")).toBe(true);
  });
});

describe("poses", () => {
  const at = (name: string, i = 0) => FRAME_AT[name]! + i;
  it("every pose starts where the strip says and the strip adds up", () => {
    expect(FRAME_AT.walk).toBe(0);
    expect(FRAME_AT.write).toBe(4);
    expect(FRAME_AT.peek).toBe(FRAMES - 2);
  });
  it("thinking raises the right hand to the face", () => {
    expect(on(walkFrame(fig(), W, W, at("think"))).has("11,5")).toBe(true); // (14,9) moved -3,-4
  });
  it("a flip turns the figure upside down at half way", () => {
    const f = on(walkFrame(fig(), W, W, at("flip", 2)));
    expect(f.has("7,12")).toBe(true); // head (8,3) -> (7,12)
  });
  it("a spin squeezes the figure narrow and a push-up lays it down", () => {
    expect(Math.max(...[...on(walkFrame(fig(), W, W, at("spin", 2)))].map((p) => +p.split(",")[0]!)) - Math.min(...[...on(walkFrame(fig(), W, W, at("spin", 2)))].map((p) => +p.split(",")[0]!))).toBeLessThan(6);
    expect(on(walkFrame(fig(), W, W, at("pushup"))).has("12,8")).toBe(true); // head (8,3) -> (12,8)
  });
});
