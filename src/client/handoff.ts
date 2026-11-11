import { Container, Graphics, Ticker } from "pixi.js";
import type { Pt } from "./path.js";

/** The mayor hands a task to an employee, or an employee hands the report back. */
export type Handoff = { kind: "assign" | "report"; id: string };

/**
 * What changed between two looks at the same staff: a new working employee was just assigned,
 * a working one that turned done just reported. `prev` null = first look, nothing to animate.
 */
export function handoffs(prev: Map<string, boolean> | null, now: { id: string; done: boolean }[]): Handoff[] {
  if (!prev) return [];
  const out: Handoff[] = [];
  for (const e of now) {
    const was = prev.get(e.id);
    if (was === undefined && !e.done) out.push({ kind: "assign", id: e.id });
    else if (was === false && e.done) out.push({ kind: "report", id: e.id });
  }
  return out;
}

const MS = 900;

/** A sheet of paper flying on an arc from `from` to `to` (pixels in `parent`), then removed. */
export function flyPaper(parent: Container, from: Pt, to: Pt, kind: Handoff["kind"]): void {
  const g = new Graphics();
  g.rect(-4, -5, 8, 10).fill(0xffffff).stroke({ color: 0x444444, width: 0.5 });
  for (let i = 0; i < 3; i++) g.rect(-2.5, -3 + i * 2.5, 5, 0.6).fill(0x9a9a9a);
  if (kind === "report") g.moveTo(-2, 3).lineTo(-0.5, 4.3).lineTo(2.5, 1).stroke({ color: 0x1f9f4a, width: 1.2 });
  g.eventMode = "none";
  g.zIndex = 1e7;
  parent.addChild(g);
  const lift = Math.max(14, Math.hypot(to.x - from.x, to.y - from.y) * 0.35);
  let t = 0;
  const step = (tk: Ticker) => {
    t += tk.deltaMS;
    const p = Math.min(1, t / MS);
    g.position.set(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * lift);
    g.rotation = Math.sin(p * Math.PI * 2) * 0.4;
    g.scale.set(1 + Math.sin(p * Math.PI) * 0.4);
    if (p >= 1 || g.destroyed) {
      Ticker.shared.remove(step);
      if (!g.destroyed) g.destroy();
    }
  };
  Ticker.shared.add(step);
}
