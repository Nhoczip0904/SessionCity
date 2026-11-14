import { Graphics, Ticker } from "pixi.js";
import { TILE } from "./city.js";

/** `lane` 0-2 = which of the river's 3 columns; `speed` in tiles/ms, negative = upstream (up the screen). */
export interface Boat { lane: number; speed: number; phase: number; hull: number; sail: number }

export const BOATS: Boat[] = [
  { lane: 0, speed: 0.0011, phase: 6, hull: 0x8a5a2b, sail: 0xf4f1e8 },
  { lane: 2, speed: -0.0014, phase: 27, hull: 0x2f5d8a, sail: 0xffd23f },
  { lane: 1, speed: 0.0008, phase: 38, hull: 0x7a2e2e, sail: 0xffffff },
];

/** Boat centre in tiles. It runs from row -1 to `rows`+1, then comes round again; x follows the river's left bank `left(row)`. */
export function boatPos(b: Boat, t: number, left: (y: number) => number, rows: number): { x: number; y: number } {
  const span = rows + 2;
  const y = -1 + ((((b.phase + b.speed * t) % span) + span) % span);
  const r = Math.floor(y), f = y - r;
  return { x: left(r) + (left(r + 1) - left(r)) * f + 0.5 + b.lane, y };
}

/** The main road bridges the river on rows 15-16: a boat there passes beneath it. */
export const underBridge = (y: number) => y > 14.6 && y < 17.4;

/** Boats drifting along the river; animates itself until destroyed. */
export function drawBoats(left: (y: number) => number, rows: number): Graphics {
  const g = new Graphics();
  g.eventMode = "none";
  let t = 0;
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS;
    g.clear();
    for (const b of BOATS) {
      const p = boatPos(b, t, left, rows);
      if (underBridge(p.y)) continue;
      const x = p.x * TILE, y = p.y * TILE, d = b.speed < 0 ? -1 : 1; // d: +1 = bow points down the screen
      g.rect(x - 4, y - 6, 8, 12).fill(b.hull);
      g.poly([x - 4, y + d * 6, x + 4, y + d * 6, x, y + d * 10]).fill(b.hull); // bow
      g.rect(x - 0.5, y - 6, 1, 9).fill(0x4a2e1a); // mast
      g.poly([x + 0.5, y - 6, x + 4, y - 2, x + 0.5, y]).fill(b.sail);
      g.rect(x - 4, y - d * 10, 8, 1).fill({ color: 0xe8f6ff, alpha: 0.45 }); // wake astern
    }
  };
  Ticker.shared.add(step);
  return g;
}
