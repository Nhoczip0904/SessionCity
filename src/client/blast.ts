import { Container, Graphics } from "pixi.js";
import { boom } from "./traffic.js";

type Rect = { x: number; y: number; w: number; h: number };

const RUIN_MS = 8000; // rubble stays this long, then the building is back
const BLASTS = [0, 250, 500, 800]; // ms after the hit; one blast each
const FADE_MS = 600; // rubble fades out at the end, like dust settling

interface Ruin { r: Rect; t: number; g: Graphics; next: number }

/** Buildings a rock can blow up: a few blasts, rubble and smoke, then rebuilt. */
export class Ruins {
  private live: Ruin[] = [];
  constructor(private layer: Container, private rects: Rect[]) {}

  /** A rock landed at (x, y) px: the building under it blows up, unless it is already rubble. */
  hit(at: { x: number; y: number }): boolean {
    const r = this.rects.find((b) => at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h);
    if (!r || this.live.some((l) => l.r === r)) return false;
    const g = new Graphics();
    g.label = "ruin";
    g.eventMode = "none";
    this.layer.addChild(g);
    this.live.push({ r, t: 0, g, next: 0 });
    this.update(0);
    return true;
  }

  update(dtMs: number): void {
    for (const l of [...this.live]) {
      l.t += dtMs;
      const { r, g } = l;
      while (l.next < BLASTS.length && l.t >= BLASTS[l.next]!) {
        const k = l.next++;
        // spread the blasts over the building, biggest first
        boom(this.layer, r.x + r.w * (0.5 + 0.3 * Math.cos(k * 2.1)), r.y + r.h * (0.5 + 0.3 * Math.sin(k * 2.1)), k ? 1.6 : 2.4);
      }
      if (l.t >= RUIN_MS) {
        g.destroy();
        this.live.splice(this.live.indexOf(l), 1);
        continue;
      }
      draw(g, r, l.t);
    }
  }
}

/** Charred ground, broken wall stubs, scattered bricks and rising smoke over the building's footprint. */
function draw(g: Graphics, r: Rect, t: number) {
  const shake = t < 900 ? Math.sin(t / 25) * 2 * (1 - t / 900) : 0;
  g.alpha = Math.min(1, t / 150, (RUIN_MS - t) / FADE_MS);
  g.clear();
  g.position.set(shake, 0);
  g.rect(r.x, r.y, r.w, r.h).fill(0x3a2f28);
  for (let i = 0; i < 6; i++) {
    // broken wall stubs along the front edge, uneven heights
    const w = r.w / 6;
    g.rect(r.x + i * w + 1, r.y + r.h - 6 - ((i * 7) % 9), w - 2, 6 + ((i * 7) % 9)).fill(0x6b5a4a);
  }
  for (let i = 0; i < 14; i++) {
    const bx = r.x + ((i * 37) % 97) / 97 * (r.w - 4);
    const by = r.y + ((i * 53) % 89) / 89 * (r.h - 4);
    g.rect(bx, by, 3, 2).fill(i % 3 ? 0x8a5a44 : 0x9a9a9a);
  }
  for (let k = 0; k < 3; k++) {
    // smoke columns drifting up and fading in a loop
    const p = ((t / 1600 + k / 3) % 1);
    g.circle(r.x + r.w * (0.25 + k * 0.25), r.y + r.h * 0.4 - p * 24, 4 + p * 8).fill({ color: 0x555555, alpha: 0.5 * (1 - p) });
  }
}
