import { Container, Graphics, Ticker } from "pixi.js";
import type { Pt } from "./path.js";

export const RELOAD = 350; // ms between shots
export const ZOOM = 1.8; // how far the map magnifies around the scope
const MS = 220;

/** A scope reticle: ring, cross hairs, red dot. `at(p)` moves it, `at(null)` hides it. */
export function scope(parent: Container): { at: (p: Pt | null) => void } {
  const g = new Graphics();
  g.circle(0, 0, 22).stroke({ width: 1.5, color: 0x111111, alpha: 0.9 }).circle(0, 0, 21).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
  g.moveTo(-34, 0).lineTo(-6, 0).moveTo(6, 0).lineTo(34, 0).moveTo(0, -34).lineTo(0, -6).moveTo(0, 6).lineTo(0, 34).stroke({ width: 1, color: 0x111111 });
  g.circle(0, 0, 1.5).fill(0xff2020);
  g.eventMode = "none";
  g.zIndex = 1e7;
  g.visible = false;
  parent.addChild(g);
  return { at: (p) => { g.visible = !!p; if (p) g.position.set(p.x, p.y); } };
}

/** A shot from `from` to `to` (pixels in `parent`): `onLand` runs at once, then the tracer and a spark fade. */
export function shoot(parent: Container, from: Pt, to: Pt, onLand: () => void): void {
  const g = new Graphics();
  g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 1.5, color: 0xfff2b0 });
  g.circle(to.x, to.y, 5).fill({ color: 0xffd060, alpha: 0.9 }).circle(to.x, to.y, 2).fill(0xffffff);
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  onLand();
  let t = 0;
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS;
    g.alpha = Math.max(0, 1 - t / MS);
    if (t >= MS) { Ticker.shared.remove(step); g.destroy(); }
  };
  Ticker.shared.add(step);
}
