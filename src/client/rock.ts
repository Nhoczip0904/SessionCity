import { Container, Graphics, Ticker } from "pixi.js";
import type { Pt } from "./path.js";

const REACH = 9; // px around the middle of a body
const BODY = 8; // px from the feet up to the middle of a body

/** Index of the person (feet at x, y) whose body is closest to where the rock landed, or -1 for a miss. */
export function nearestHit(people: Pt[], at: Pt): number {
  let best = -1, bestD = REACH;
  people.forEach((p, i) => {
    const d = Math.hypot(p.x - at.x, p.y - BODY - at.y);
    if (d <= bestD) { best = i; bestD = d; }
  });
  return best;
}

const MS = 600;

/** A stone thrown on an arc from `from` to `to` (pixels in `parent`); `onLand` runs where it lands, then it rolls and goes. */
export function flyRock(parent: Container, from: Pt, to: Pt, onLand: () => void): void {
  const g = new Graphics().circle(0, 0, 2.5).fill(0x8a8478).circle(-0.8, -0.8, 1).fill(0xb8b2a6);
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  const lift = Math.max(20, Math.hypot(to.x - from.x, to.y - from.y) * 0.4);
  let t = 0, landed = false;
  const step = (tk: Ticker) => {
    t += tk.deltaMS;
    const p = Math.min(1, t / MS);
    if (g.destroyed) return void Ticker.shared.remove(step);
    if (p < 1) {
      g.position.set(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * lift);
      g.rotation = p * 12;
      return;
    }
    if (!landed) { landed = true; g.position.set(to.x, to.y); onLand(); }
    g.alpha = Math.max(0, 1 - (t - MS) / 500); // lies there a moment, then fades
    if (g.alpha === 0) { Ticker.shared.remove(step); g.destroy(); }
  };
  Ticker.shared.add(step);
}
