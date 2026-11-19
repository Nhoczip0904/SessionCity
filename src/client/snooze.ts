import { Container, Text } from "pixi.js";
import type { Pt } from "./path.js";

const CYCLE_MS = 2400, RISE = 14, BREATH_MS = 2600;

/** Sleepers: a "z" floats up from each head (`at` is just above it, in pixels) and their body breathes. Returns the per-frame step. */
export function snooze(parent: Container, sleepers: (Pt & { fig?: Container | null })[]): (dtMs: number) => void {
  const zs = sleepers.map(() => {
    const z = new Text({ text: "z", style: { fontFamily: "Consolas, monospace", fontSize: 7, fontWeight: "bold", fill: 0x9ad0ff, stroke: { color: 0x111111, width: 2 } }, resolution: 4, textureStyle: { scaleMode: "linear" } });
    z.anchor.set(0.5, 1);
    z.eventMode = "none";
    z.zIndex = 1e7;
    parent.addChild(z);
    return z;
  });
  let t = 0;
  const place = () => sleepers.forEach((s, i) => {
    const p = ((t + i * 800) % CYCLE_MS) / CYCLE_MS, z = zs[i];
    z.position.set(s.x + 3 * Math.sin(p * Math.PI * 2), s.y - RISE * p);
    z.alpha = 1 - p;
    z.scale.set(0.7 + 0.5 * p);
    if (s.fig) s.fig.scale.y = 1 + 0.03 * Math.sin(((t + i * 500) / BREATH_MS) * Math.PI * 2);
  });
  place();
  return (dt) => {
    if (!sleepers.length || zs[0].destroyed) return;
    t += dt;
    place();
  };
}
