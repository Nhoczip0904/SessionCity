import { Container, Graphics, Ticker } from "pixi.js";
import type { Pt } from "./path.js";
import { boom } from "./traffic.js";

export const METEOR_R = 80; // px around the crater that the blast reaches
const FALL = 700; // ms from the sky to the ground
const SKY = 260; // px above (and to the side of) the target the rock starts from
const RING = 600; // ms the shock ring spreads

/** A flaming rock falls on `to` (pixels in `parent`); `onLand` runs at the impact, then a ring, a crater and fire fade out. */
export function meteor(parent: Container, to: Pt, onLand: () => void, radius = METEOR_R): void {
  const g = new Graphics();
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  let t = 0, landed = false;
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS;
    g.clear();
    if (t < FALL) {
      const p = t / FALL, x = to.x + SKY * 0.5 * (1 - p), y = to.y - SKY * (1 - p);
      g.circle(to.x, to.y, radius * p * 0.6).stroke({ width: 1, color: 0xff6a20, alpha: 0.4 * p }); // warning ring
      for (let k = 4; k > 0; k--) g.circle(x + k * 5, y - k * 9, 5 - k).fill({ color: 0xff9a30, alpha: 0.18 * (5 - k) }); // tail
      g.circle(x, y, 6).fill(0x6a3a22).circle(x, y, 3).fill(0xffd060);
      return;
    }
    if (!landed) { landed = true; boom(parent, to.x, to.y, 3); onLand(); }
    const q = (t - FALL) / RING;
    if (q >= 1) { Ticker.shared.remove(step); return void g.destroy(); }
    g.ellipse(to.x, to.y, radius * 0.5, radius * 0.3).fill({ color: 0x1a1a1a, alpha: 0.5 * (1 - q) }); // scorch
    g.circle(to.x, to.y, radius * Math.min(1, q * 1.6)).stroke({ width: 4 * (1 - q) + 1, color: 0xffe0a0, alpha: 1 - q });
  };
  Ticker.shared.add(step);
}
