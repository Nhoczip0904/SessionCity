import { Container, Graphics, Ticker } from "pixi.js";
import type { Pt } from "./path.js";
import { boom } from "./traffic.js";

export const SAT_R = 70; // px around the target that the laser burns
const SKY = 230; // px above the target the satellite hangs
const COME = 700, AIM = 600, BEAM = 800, FADE = 600; // ms per phase: glide in, lock on, fire, scorch fades

/** A satellite glides over `to` (pixels in `parent`), locks on, then fires a laser; `onFire` runs when the beam starts. */
export function satellite(parent: Container, to: Pt, onFire: () => void, radius = SAT_R): void {
  const g = new Graphics();
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  let t = 0, fired = false;
  const body = (x: number, y: number, glow: number) => {
    g.rect(x - 14, y - 2, 9, 5).fill(0x2a5fa8).rect(x + 5, y - 2, 9, 5).fill(0x2a5fa8); // solar panels
    g.rect(x - 5, y - 5, 10, 10).fill(0xc8ccd4).stroke({ width: 1, color: 0x444a55 });
    g.circle(x, y + 5, 2 + glow * 2).fill({ color: 0xff3030, alpha: 0.4 + 0.6 * glow }); // lens
  };
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS;
    g.clear();
    const y = to.y - SKY;
    if (t < COME) { // drifts in from the left edge of its orbit
      const p = t / COME;
      return void body(to.x - 220 * (1 - p), y, 0);
    }
    if (t < COME + AIM) { // red lock-on ring shrinking onto the target
      const p = (t - COME) / AIM;
      body(to.x, y, p);
      g.circle(to.x, to.y, radius * (1.6 - 0.6 * p)).stroke({ width: 1.5, color: 0xff3030, alpha: 0.3 + 0.6 * p });
      g.moveTo(to.x - 6, to.y).lineTo(to.x + 6, to.y).moveTo(to.x, to.y - 6).lineTo(to.x, to.y + 6).stroke({ width: 1, color: 0xff3030 });
      return;
    }
    if (!fired) { fired = true; boom(parent, to.x, to.y, 3); onFire(); }
    const q = (t - COME - AIM) / (BEAM + FADE);
    if (q >= 1) { Ticker.shared.remove(step); return void g.destroy(); }
    const burning = t < COME + AIM + BEAM, w = 10 + 4 * Math.sin(t / 30);
    body(to.x, y, 1);
    g.ellipse(to.x, to.y, radius, radius * 0.6).fill({ color: 0x1a1a1a, alpha: 0.5 * (1 - q) }); // scorch
    if (burning) {
      g.rect(to.x - w / 2, y + 6, w, to.y - y - 6).fill({ color: 0xff2020, alpha: 0.55 });
      g.rect(to.x - w / 5, y + 6, w / 2.5, to.y - y - 6).fill(0xffffff);
      g.circle(to.x, to.y, radius * 0.5 + 6 * Math.sin(t / 40)).fill({ color: 0xffd060, alpha: 0.7 }); // flare where it lands
    }
    g.circle(to.x, to.y, radius).stroke({ width: 2, color: 0xff6a20, alpha: 1 - q });
  };
  Ticker.shared.add(step);
}
