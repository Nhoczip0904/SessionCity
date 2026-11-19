import type { Graphics } from "pixi.js";
import type { DeskJob } from "./rooms.js";

const SKIN = 0xf0c8a0;
const mix = (a: number, b: number, k: number) => [16, 8, 0].reduce((o, s) => o | (Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s), 0);

/** An open book 11 wide at (x, y); `leaf` 0..1 is a page turning over the spine (0 = flat). */
function book(g: Graphics, x: number, y: number, leaf: number) {
  g.rect(x - 1, y + 7.5, 12, 1.5).fill(0x6b3a1e);
  g.rect(x, y + 3, 5, 5).fill(0xf4f1e8).rect(x + 5, y + 3, 5, 5).fill(0xfffdf5).rect(x + 4.5, y + 3, 1, 5).fill(0x8a5a2b);
  for (const i of [0, 1]) g.rect(x + 1, y + 4.5 + i * 1.8, 3, 0.5).fill(0xb8b0a0).rect(x + 6, y + 4.5 + i * 1.8, 3, 0.5).fill(0xb8b0a0);
  if (leaf > 0) {
    const c = Math.cos(leaf * Math.PI), w = Math.abs(c) * 5;
    g.rect(c > 0 ? x + 5 : x + 5 - w, y + 2 - Math.sin(leaf * Math.PI), w, 5).fill(0xffffff);
  }
}

/** Blueprint sheet (blue, pale border) `w` wide at (x, y + 2). */
const sheet = (g: Graphics, x: number, y: number, w = 12) => g.rect(x, y + 2, w, 7).fill(0x2f6fb5).rect(x, y + 2, w, 7).stroke({ color: 0x9cc8f0, width: 0.5 });

/** A laptop: screen on top, `inner` the screen colour. */
const laptop = (g: Graphics, x: number, y: number, inner: number) =>
  g.rect(x, y + 7, 12, 2).fill(0xb8bec8).rect(x + 1, y, 10, 7).fill(0x20262e).rect(x + 2, y + 1, 8, 5).fill(inner);

/** A turn of the page: 0 most of the time, rising to 1 for a `share` of every `ms`. */
const turn = (t: number, ms: number, share: number, p: number) => ((t / ms + p * 0.3) % 1 < share ? ((t / ms + p * 0.3) % 1) / share : 0);

/** One person at a desk, in a box about 13 × 10 at (x, y); animated while `on` (t in ms), still otherwise. `p` keeps neighbours out of step. */
export function drawDeskJob(g: Graphics, job: DeskJob, x: number, y: number, t: number, on: boolean, p: number): void {
  const tt = on ? t : 0;
  switch (job) {
    case "read": // an open book, a page turns now and then
      book(g, x, y, turn(tt, 1100, 0.4, p));
      break;
    case "candle": { // the same book by a candle, flame flickering, slower pages
      book(g, x, y, turn(tt, 2200, 0.2, p));
      const h = on ? 2 + Math.sin(tt / 90 + p) * 0.8 : 2;
      g.circle(x + 12, y + 2, 4).fill({ color: 0xffb030, alpha: 0.12 }).rect(x + 11, y + 4, 2, 4).fill(0xf2e8c8).rect(x + 11.5, y + 4 - h, 1, h).fill(0xffb030);
      break;
    }
    case "quill": { // notes: a quill scratches along the page and the line grows
      book(g, x, y, 0);
      const k = on ? (tt / 300 + p) % 4 : 1;
      g.rect(x + 5.5, y + 6.5, 1 + k, 0.5).fill(0x1c2a5a);
      g.rect(x + 6 + k, y + 1, 2, 3).fill(0xf4f4f4).rect(x + 5.5 + k, y + 4, 1, 3).fill(0x333333);
      break;
    }
    case "draft": { // lines grow over the blueprint, a pencil at the tip
      sheet(g, x, y);
      const n = on ? Math.floor((tt / 400 + p) % 8) : 5;
      for (let i = 0; i < n; i++) {
        if (i % 2) g.rect(x + 2 + i, y + 3, 0.5, 4 + (i % 3)).fill(0xdbeaff);
        else g.rect(x + 1, y + 3 + (i >> 1) * 1.6, 4 + ((i * 3) % 6), 0.5).fill(0xdbeaff);
      }
      if (on) g.rect(x + 2 + n, y + 6, 1, 3).fill(0xf2c200);
      break;
    }
    case "roll": { // the blueprint unrolls and rolls up again
      const w = on ? 4 + 6 * (0.5 + 0.5 * Math.sin(tt / 800 + p)) : 8;
      sheet(g, x + 2, y, w);
      g.rect(x + 3, y + 4, Math.max(0, w - 2), 0.5).fill(0xdbeaff).rect(x + 3, y + 6, Math.max(0, w - 4), 0.5).fill(0xdbeaff);
      g.rect(x, y + 2, 2.5, 7).fill(0xd8c8a0).rect(x + 2 + w, y + 2, 2.5, 7).fill(0xd8c8a0);
      break;
    }
    case "lens": { // a magnifier sweeps over the blueprint
      sheet(g, x, y);
      g.rect(x + 1, y + 4, 8, 0.5).fill(0xdbeaff).rect(x + 1, y + 6, 6, 0.5).fill(0xdbeaff);
      const mx = x + 3 + (on ? 4 + 4 * Math.sin(tt / 700 + p) : 4);
      g.circle(mx, y + 5, 2.5).fill({ color: 0xcfe8ff, alpha: 0.35 }).circle(mx, y + 5, 2.5).stroke({ color: 0xdddddd, width: 1 }).rect(mx + 2, y + 7, 1, 3).fill(0x8a5a2b);
      break;
    }
    case "laptop": { // rows of data scroll up the screen
      laptop(g, x, y, 0x0c2c1c);
      const off = on ? Math.floor(tt / 180 + p) : 0;
      for (let i = 0; i < 4; i++) g.rect(x + 3, y + 1.5 + i * 1.1, 2 + (((i + off) * 7) % 5), 0.6).fill(0x66ff99);
      break;
    }
    case "chart": { // bars rise and fall
      laptop(g, x, y, 0x10243f);
      for (let i = 0; i < 4; i++) {
        const h = on ? 1 + ((Math.sin(tt / 500 + i * 1.3 + p) + 1) / 2) * 3 : 2;
        g.rect(x + 3 + i * 2, y + 5.5 - h, 1.4, h).fill([0xff7a59, 0xffd23f, 0x5ad1a0, 0x6aa8ff][i]!);
      }
      break;
    }
    case "pour": { // a flask pours into a beaker, the level rises and the colour turns
      const f = on ? (tt / 3000 + p / 16) % 1 : 0.5, pouring = !on || f < 0.75, lv = 1 + 3 * Math.min(1, f / 0.75);
      g.rect(x + 7, y + 3, 5, 6).fill({ color: 0xdff4f8, alpha: 0.5 }).rect(x + 7.5, y + 8.5 - lv, 4, lv).fill(mix(0x40c0ff, 0x80ff60, f));
      g.rect(x, y + 1, 4, 5).fill({ color: 0xdff4f8, alpha: 0.6 }).rect(x + 1, y, 2, 1).fill(0xdff4f8).rect(x + 0.5, y + 3, 3, 2.5).fill(0x40c0ff);
      if (pouring) g.rect(x + 4, y + 2, 0.8, 6.5 - lv).fill(0x60d0ff);
      if (on) for (let k = 0; k < 2; k++) g.circle(x + 9 + k * 2, y + 3 - ((tt / 200 + k * 1.5) % 3), 0.6).fill({ color: 0xffffff, alpha: 0.7 });
      break;
    }
    case "drip": { // a dropper feeds a test tube, which changes colour
      const c = on ? Math.floor(tt / 1500 + p) % 2 : 0;
      for (const [i, col] of [[0, 0x9fe8a0], [4, c ? 0xff7ac6 : 0x7ad8ff], [8, 0xffd27a]] as const) {
        g.rect(x + i, y + 4, 3, 5).fill({ color: 0xdff4f8, alpha: 0.5 }).rect(x + i + 0.5, y + 6, 2, 2.5).fill(col);
      }
      g.rect(x + 5, y, 1, 2.5).fill(0x555555).rect(x + 4.5, y + 2.5, 2, 1).fill(0xc0392b);
      if (on) g.circle(x + 5.5, y + 3.5 + ((tt / 250 + p) % 4) * 0.7, 0.7).fill(0x80e0ff);
      break;
    }
    case "console": { // keyboard under busy hands, keys flashing
      g.rect(x + 1, y + 5, 10, 3).fill(0x2a2e35);
      for (let i = 0; i < 8; i++) g.rect(x + 1.5 + i * 1.2, y + 5.5, 1, 1).fill(on && Math.floor(tt / 110 + i * 7 + p) % 3 === 0 ? 0x9aa5b8 : 0x4a5160);
      g.rect(x + 3, y + 3 + (on ? Math.sin(tt / 90 + p) * 0.8 : 0), 2, 2).fill(SKIN).rect(x + 7, y + 3 + (on ? Math.cos(tt / 90 + p) * 0.8 : 0), 2, 2).fill(SKIN);
      break;
    }
  }
}
