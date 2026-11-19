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

const mix = (c: number, k: number) => [16, 8, 0].reduce((o, s) => o | (Math.round(((c >> s) & 255) * (1 + k)) << s), 0);

/** One boat centred on (x, y) pixels; `d` +1 = bow points down the screen. `t` ms drives the bob, the sails, the flag and the wake. */
export function drawBoat(g: Graphics, b: Boat, x: number, y0: number, d: number, t: number): void {
  const y = y0 + Math.round(Math.sin(t / 600 + b.phase) * 0.6);
  const sway = Math.sin(t / 500 + b.phase), ripple = 0.25 + 0.15 * Math.sin(t / 350 + b.phase);
  g.ellipse(x + 1, y + 2, 6, 11).fill({ color: 0x0a2a44, alpha: 0.2 }); // shadow on the water
  for (const k of [0, 1, 2]) for (const s of [-1, 1]) // wake: three ripples fanning out astern
    g.moveTo(x + s * 3, y - d * (8 + k * 4)).lineTo(x + s * (6 + k * 2), y - d * (12 + k * 4)).stroke({ color: 0xe8f6ff, width: 1, alpha: ripple * (1 - k * 0.25) });
  const dark = mix(b.hull, -0.4), deck = mix(b.hull, 0.35);
  g.rect(x - 5, y - 7, 10, 14).fill(dark).poly([x - 5, y + d * 7, x + 5, y + d * 7, x, y + d * 12]).fill(dark); // outline
  g.rect(x - 4, y - 6, 8, 12).fill(b.hull).poly([x - 4, y + d * 6, x + 4, y + d * 6, x, y + d * 10]).fill(b.hull);
  g.rect(x - 3, y - 5, 6, 10).fill(deck).rect(x - 3, y - 1, 6, 1).fill({ color: dark, alpha: 0.5 }).rect(x - 3, y + 2, 6, 1).fill({ color: dark, alpha: 0.5 }); // planks
  g.rect(x - 2, d > 0 ? y - 5 : y + 2, 4, 3).fill(dark).rect(x - 2, d > 0 ? y - 5 : y + 2, 4, 1).fill(mix(dark, 0.5)); // cabin at the stern
  g.rect(x - 0.5, y - 13, 1, 13).fill(0x4a2e1a); // mast
  g.poly([x + 0.5, y - 12, x + 6 + sway, y - 6, x + 0.5, y - 1]).fill(b.sail).poly([x + 0.5, y - 12, x + 3 + sway, y - 7, x + 0.5, y - 7]).fill({ color: 0x000000, alpha: 0.08 }); // main sail, billowing
  g.poly([x - 0.5, y - 10, x - 4 - sway * 0.5, y - 5, x - 0.5, y - 2]).fill(mix(b.sail, -0.12)); // jib
  g.poly([x + 0.5, y - 13, x + 4 + sway * 1.5, y - 14, x + 0.5, y - 15]).fill(0xd93a3a); // pennant
}

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
      drawBoat(g, b, p.x * TILE, p.y * TILE, b.speed < 0 ? -1 : 1, t);
    }
  };
  Ticker.shared.add(step);
  return g;
}
