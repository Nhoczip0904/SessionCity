import { Container, Graphics, Ticker } from "pixi.js";
import type { Session } from "../shared/types.js";
import type { Pt } from "./path.js";

/** Spots the sessions that just finished a turn: `working` → `idle`, with a permission question in between allowed. */
export class Finishes {
  private last: Map<string, string> | null = null; // null until the first look: sessions already idle at load are not news

  update(sessions: Pick<Session, "id" | "status">[]): string[] {
    const prev = this.last;
    const done: string[] = [];
    this.last = new Map(
      sessions.map((s) => {
        const was = prev?.get(s.id);
        if (was === "working" && s.status === "idle") done.push(s.id);
        return [s.id, s.status === "waiting" && was ? was : s.status];
      }),
    );
    return done;
  }
}

/** How many sessions finished on `day` (a local date), from the stored "day:n"; 0 for another day or garbage. */
export function readDone(raw: string | null, day: string): number {
  const [d, n] = (raw ?? "").split(":");
  return d === day && Number.isInteger(+n) && +n > 0 ? +n : 0;
}
export const writeDone = (day: string, n: number) => `${day}:${n}`;

const COLORS = [0xff5a5a, 0xffd23f, 0x5ad1ff, 0x7dff7a, 0xff8aff];
const BURST_MS = 1100, GAP_MS = 350;

/** Three sparks-bursts above `at` (pixels in `parent`), one after the other, then gone. */
export function fireworks(parent: Container, at: Pt, rand: () => number = Math.random): void {
  const g = new Graphics();
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  const bursts = [0, 1, 2].map((i) => ({
    x: at.x + (rand() - 0.5) * 40,
    y: at.y - 24 - rand() * 20,
    delay: i * GAP_MS,
    color: COLORS[Math.floor(rand() * COLORS.length)],
  }));
  let t = 0;
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS;
    g.clear();
    for (const b of bursts) {
      const s = (t - b.delay) / BURST_MS;
      if (s < 0 || s > 1) continue;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        g.circle(b.x + Math.cos(a) * 26 * s, b.y + Math.sin(a) * 26 * s + 12 * s * s, 1.4).fill({ color: b.color, alpha: 1 - s });
      }
    }
    if (t > 2 * GAP_MS + BURST_MS) {
      Ticker.shared.remove(step);
      g.destroy();
    }
  };
  Ticker.shared.add(step);
}
