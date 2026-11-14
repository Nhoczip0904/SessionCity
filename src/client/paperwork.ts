import type { Graphics } from "pixi.js";

const CYCLE = 4000, STAMP_MS = 400;

/** 0 while the stamp is up, rising to 1 and back to 0 once per cycle; `phase` keeps neighbours out of step. */
export function stampDown(t: number, phase: number): number {
  const c = (t + phase * 250) % CYCLE;
  return c > CYCLE - STAMP_MS ? Math.sin(((c - (CYCLE - STAMP_MS)) / STAMP_MS) * Math.PI) : 0;
}

/** Papers on a desk with (x, y) as their top-left: the top sheet shuffles about, now and then a stamp comes down. */
export function drawPapers(g: Graphics, x: number, y: number, t: number, phase: number): void {
  const flip = Math.sin(t / 220 + phase);
  g.rect(x, y + 2, 9, 6).fill(0xf4f1e8);
  g.rect(x + 1 + flip * 2.5, y + (flip > 0.6 ? 0 : 1), 9, 6).fill(0xffffff).stroke({ color: 0xcfc8b8, width: 0.5 });
  const s = stampDown(t, phase);
  if (s) g.rect(x + 3, y - 4 + s * 5, 4, 4).fill(0xc0392b);
}
