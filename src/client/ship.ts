import { Container, Graphics, Ticker } from "pixi.js";
import type { Session } from "../shared/types.js";
import type { Pt } from "./path.js";

export interface Ship { id: string; kind: "push" | "pr" }

/** Spots sessions whose push / PR count went up since the last look; sessions already known at load or new later are not news. */
export class Ships {
  private last: Map<string, { push: number; pr: number }> | null = null;

  update(sessions: Pick<Session, "id" | "ships">[]): Ship[] {
    const prev = this.last;
    const out: Ship[] = [];
    this.last = new Map(
      sessions.map((s) => {
        const now = s.ships ?? { push: 0, pr: 0 };
        const was = prev?.get(s.id);
        if (was) for (const kind of ["push", "pr"] as const) if (now[kind] > was[kind]) out.push({ id: s.id, kind });
        return [s.id, now];
      }),
    );
    return out;
  }
}

const FLY_MS = 3200, SPAN = 420;

/** A little paper plane crossing left to right over `at` (pixels in `parent`), blue for a push, green for a PR. */
export function flyPlane(parent: Container, at: Pt, kind: Ship["kind"]): void {
  const g = new Graphics();
  const c = kind === "push" ? 0x5ad1ff : 0x7dff7a;
  g.poly([12, 0, -10, -7, -5, 0, -10, 7]).fill(0xffffff).stroke({ width: 1, color: c });
  g.poly([-5, 0, -10, 7, 0, 3]).fill(c);
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  let t = 0;
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS;
    const s = Math.min(1, t / FLY_MS);
    g.x = at.x - SPAN / 2 + SPAN * s;
    g.y = at.y - 30 * Math.sin(s * Math.PI);
    g.rotation = -0.35 * Math.cos(s * Math.PI);
    if (s >= 1) {
      Ticker.shared.remove(step);
      g.destroy();
    }
  };
  g.x = at.x - SPAN / 2;
  g.y = at.y;
  Ticker.shared.add(step);
}
