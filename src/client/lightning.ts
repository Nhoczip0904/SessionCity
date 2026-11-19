import { Container, Graphics, Ticker } from "pixi.js";
import type { Pt } from "./path.js";

const MS = 450;
export const BOLT_R = 44; // px around the strike that the blast reaches
const SKY = 220; // px above the target the bolt starts from

/** A bolt from the sky to `to` (pixels in `parent`); `onLand` runs at once, then the flash fades and goes. */
export function strike(parent: Container, to: Pt, onLand: () => void, radius = 12): void {
  const g = new Graphics();
  const pts: Pt[] = [{ x: to.x + (Math.random() - 0.5) * 60, y: to.y - SKY }];
  for (let i = 1; i < 8; i++) pts.push({ x: to.x + (Math.random() - 0.5) * 36 * (1 - i / 8), y: to.y - SKY + (SKY * i) / 8 });
  pts.push(to);
  g.poly(pts.flatMap((p) => [p.x, p.y]), false).stroke({ width: 5, color: 0xfff6a8, alpha: 0.5 });
  g.poly(pts.flatMap((p) => [p.x, p.y]), false).stroke({ width: 2, color: 0xffffff });
  g.circle(to.x, to.y, radius).fill({ color: 0xfff6a8, alpha: 0.35 }).stroke({ width: 2, color: 0xfff6a8, alpha: 0.8 });
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  onLand();
  let t = 0;
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS;
    g.alpha = Math.max(0, 1 - t / MS) * (Math.floor(t / 60) % 2 ? 0.6 : 1); // flickers while it fades
    if (t >= MS) { Ticker.shared.remove(step); g.destroy(); }
  };
  Ticker.shared.add(step);
}
