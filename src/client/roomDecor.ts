import { Graphics } from "pixi.js";
import type { Decor, Job } from "./rooms.js";

const T = 16;
/** Left/right wall panels beside the board (board spans x 50–206 on rows 0–1). */
export const LEFT = { x: 4, y: 5, w: 42, h: 23 }, RIGHT = { x: 210, y: 5, w: 42, h: 23 };
/** The part of each department's room that opens its board when tapped. */
export const SPOTS: Partial<Record<Decor, { x: number; y: number; w: number; h: number; name: string }>> = {
  shelves: { x: 48, y: 32, w: 48, h: 32, name: "Kệ sách" },
  pinboard: { ...LEFT, name: "Bàn vẽ" },
  worksite: { ...LEFT, name: "Bản vẽ thi công" },
  racks: { x: 80, y: 48, w: 32, h: 48, name: "Sổ migration" },
  flasks: { ...LEFT, name: "Bảng kết quả" },
  conveyor: { x: 0, y: 32, w: 32, h: 48, name: "Dây chuyền" },
  carousel: { ...LEFT, name: "Bảng chuyến bay" },
  radar: { ...LEFT, name: "Radar log" },
  fireplace: { x: 4, y: 2, w: 42, h: 30, name: "Phòng khách" },
  stage: { x: 72, y: 32, w: 112, h: 28, name: "Hộp thư" },
};
const hash = (n: number) => (((n * 2654435761) >>> 0) % 1000) / 1000;

export type Anim = (draw: (g: Graphics, t: number) => void) => void;

function panel(g: Graphics, p: typeof LEFT, frame: number, face: number) {
  g.rect(p.x + 1, p.y + 1, p.w, p.h).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(p.x, p.y, p.w, p.h).fill(frame).rect(p.x + 2, p.y + 2, p.w - 4, p.h - 4).fill(face);
}

/** Set pieces under the furniture and people (floor, walls). */
export function decorUnder(kind: Decor, anim: Anim) {
  switch (kind) {
    case "shelves": // warm pools of lamp light on the reading rug
      return anim((g, t) => {
        const a = 0.1 + 0.02 * Math.sin(t / 400);
        g.circle(7.5 * T, 3 * T, 30).fill({ color: 0xffc070, alpha: a }).circle(8.5 * T, 3 * T, 18).fill({ color: 0xffe0a0, alpha: a });
      });
    case "pinboard":
      return anim((g) => {
        panel(g, LEFT, 0x8a5a36, 0xc49a6c);
        const notes = [0xffe066, 0xff8fa3, 0x8fd6ff, 0xa6f08f];
        for (let i = 0; i < 10; i++) g.rect(LEFT.x + 4 + (i % 5) * 7, LEFT.y + 4 + Math.floor(i / 5) * 8, 6, 6).fill(notes[i % 4]);
        // blueprint grid over the design rug
        for (let x = 5.5 * T + 4; x < 10.5 * T; x += 6) g.rect(x, 2.6 * T + 3, 0.5, 3 * T - 6).fill({ color: 0xffffff, alpha: 0.35 });
        for (let y = 2.6 * T + 4; y < 5.6 * T - 3; y += 6) g.rect(5.5 * T + 3, y, 5 * T - 6, 0.5).fill({ color: 0xffffff, alpha: 0.35 });
      });
    case "worksite":
      return anim((g) => {
        // scaffolding on the left wall
        for (let x = LEFT.x; x <= LEFT.x + LEFT.w; x += 14) g.rect(x, 3, 2, 29).fill(0x8c8c8c);
        for (let y = 8; y < 32; y += 10) g.rect(LEFT.x, y, LEFT.w + 2, 2).fill(0x8c8c8c).rect(LEFT.x, y + 2, LEFT.w + 2, 2).fill(0xb07a3a);
        // hazard tape around the work zone
        const x0 = 4.5 * T, y0 = 2.8 * T, w = 7 * T, h = 2.4 * T;
        for (let i = 0; i < w; i += 6) {
          const c = (i / 6) % 2 ? 0x222222 : 0xf2c200;
          g.rect(x0 + i, y0, 6, 2).fill(c).rect(x0 + i, y0 + h, 6, 2).fill(c);
        }
        for (let i = 0; i < h; i += 6) {
          const c = (i / 6) % 2 ? 0x222222 : 0xf2c200;
          g.rect(x0, y0 + i, 2, 6).fill(c).rect(x0 + w, y0 + i, 2, 6).fill(c);
        }
      });
    case "racks":
      return anim((g, t) => {
        g.rect(0, 3, 16 * T, 3).fill(0xd4b030); // cable tray under the ceiling
        for (let y = 2; y < 12; y++) for (let x = 0; x < 16; x++) for (const [dx, dy] of [[5, 5], [10, 5], [5, 10], [10, 10]]) g.rect(x * T + dx, y * T + dy, 1, 1).fill({ color: 0x000000, alpha: 0.35 });
        // cold air rising from the floor between the rack rows
        const a = 0.12 + 0.06 * Math.sin(t / 500);
        g.rect(7 * T, 3 * T, 2 * T, 2 * T).fill({ color: 0x70c8ff, alpha: a });
      });
    case "flasks":
      return anim((g, t) => {
        panel(g, LEFT, 0x3a4a3e, 0x10241a);
        for (let i = 0; i < 5; i++) {
          const ok = i !== 3;
          g.rect(LEFT.x + 4, LEFT.y + 4 + i * 3.4, 2, 2).fill(ok ? 0x5cff8a : 0xff5c5c);
          g.rect(LEFT.x + 8, LEFT.y + 4 + i * 3.4, 10 + hash(i) * 20, 2).fill(ok ? 0x2f8f50 : 0x8f2f2f);
        }
        const p = (t / 4000) % 1; // running test bar
        g.rect(LEFT.x + 4, LEFT.y + LEFT.h - 4, (LEFT.w - 8) * p, 1.5).fill(0xffe066);
      });
    case "diff":
      return anim((g, t) => {
        panel(g, LEFT, 0x2a2a34, 0x1b1b22);
        const kinds = [0, 1, 1, 0, 2, 2, 2, 0];
        kinds.forEach((k, i) => {
          const y = LEFT.y + 3 + i * 2.3;
          if (k) g.rect(LEFT.x + 2, y, LEFT.w - 4, 2).fill(k === 1 ? 0x5a1f25 : 0x1f4d2a);
          g.rect(LEFT.x + 5, y + 0.5, 8 + hash(i + 3) * 24, 1).fill(k === 1 ? 0xff8a8a : k === 2 ? 0x8aff9a : 0x9a9aa8);
        });
        if (Math.floor(t / 500) % 2) g.rect(LEFT.x + 5, LEFT.y + LEFT.h - 4, 3, 1).fill(0xffffff);
      });
    case "conveyor":
      return anim((g, t) => {
        const x0 = 2 * T, x1 = 14 * T, y0 = 3.2 * T, h = 1.3 * T;
        g.rect(x0, y0 + h, x1 - x0, 3).fill({ color: 0x000000, alpha: 0.25 });
        g.rect(x0, y0, x1 - x0, h).fill(0x3a3a3a);
        const off = (t / 40) % 8;
        for (let x = x0 - 8 + off; x < x1; x += 8) if (x >= x0) g.rect(x, y0 + 2, 1, h - 4).fill(0x555555);
        for (let i = 0; i < x1 - x0; i += 6) g.rect(x0 + i, y0 - 2, 6, 2).fill((i / 6) % 2 ? 0x222222 : 0xf2c200).rect(x0 + i, y0 + h, 6, 2).fill((i / 6) % 2 ? 0x222222 : 0xf2c200);
        for (let k = 0; k < 4; k++) {
          const x = x0 + ((t / 40 + k * 48) % (x1 - x0 - 10));
          g.rect(x, y0 + 4, 10, 10).fill(0xb0824a).rect(x, y0 + 8, 10, 1.5).fill(0x7a5630);
        }
      });
    case "carousel":
      return anim((g, t) => {
        // departure board
        panel(g, LEFT, 0x30343a, 0x111418);
        for (let i = 0; i < 5; i++) {
          g.rect(LEFT.x + 4, LEFT.y + 4 + i * 3.4, 10, 1.5).fill(0xffb020);
          g.rect(LEFT.x + 17, LEFT.y + 4 + i * 3.4, 12, 1.5).fill(0xffd070);
          const blink = i === 1 && Math.floor(t / 600) % 2;
          g.rect(LEFT.x + 32, LEFT.y + 4 + i * 3.4, 6, 1.5).fill(blink ? 0x111418 : i === 1 ? 0x5cff8a : 0xffb020);
        }
        // baggage carousel
        const x0 = 4.5 * T, y0 = 2.8 * T, w = 7 * T, h = 2.2 * T;
        g.roundRect(x0 + 1, y0 + 2, w, h, 12).fill({ color: 0x000000, alpha: 0.25 });
        g.roundRect(x0, y0, w, h, 12).fill(0x50555c).roundRect(x0 + 6, y0 + 6, w - 12, h - 12, 7).fill(0x8a9098);
        const per = 2 * (w - 12) + 2 * (h - 12);
        for (let k = 0; k < 6; k++) {
          let d = (t / 30 + (k * per) / 6) % per;
          let x: number, y: number;
          if (d < w - 12) { x = x0 + 3 + d; y = y0 + 1; }
          else if ((d -= w - 12) < h - 12) { x = x0 + w - 9; y = y0 + 3 + d; }
          else if ((d -= h - 12) < w - 12) { x = x0 + w - 9 - d; y = y0 + h - 7; }
          else { d -= w - 12; x = x0 + 1; y = y0 + h - 9 - d; }
          g.roundRect(x, y, 7, 6, 1.5).fill([0xd04040, 0x3a6ad0, 0x2f9f5a, 0xe0b030, 0x8a4ad0, 0x404040][k]);
        }
      });
    case "radar":
      return anim((g, t) => {
        for (const p of [LEFT, RIGHT]) {
          panel(g, p, 0x2a302a, 0x08140c);
          const scroll = Math.floor(t / 250);
          for (let i = 0; i < 6; i++) g.rect(p.x + 4, p.y + 3 + i * 3, 6 + hash(i + scroll + p.x) * (p.w - 14), 1).fill(hash(i + scroll) > 0.85 ? 0xff6060 : 0x5cff8a);
        }
        const cx = 8 * T, cy = 3.9 * T, r = 15;
        g.circle(cx, cy + 2, r + 2).fill({ color: 0x000000, alpha: 0.3 });
        g.circle(cx, cy, r + 2).fill(0x2a302a).circle(cx, cy, r).fill(0x062010);
        g.circle(cx, cy, r * 0.66).stroke({ color: 0x1f6a3a, width: 0.5 }).circle(cx, cy, r * 0.33).stroke({ color: 0x1f6a3a, width: 0.5 });
        const a = (t / 900) % (Math.PI * 2);
        for (let i = 0; i < 6; i++) {
          const b = a - i * 0.12;
          g.moveTo(cx, cy).lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r).stroke({ color: 0x5cff8a, width: 1.2, alpha: 1 - i / 6 });
        }
        g.circle(cx + 6, cy - 4, 1).fill(0xff6060).circle(cx - 5, cy + 6, 1).fill(0x5cff8a);
      });
    case "fireplace":
      return anim((g, t) => {
        const x = LEFT.x + 2, w = LEFT.w - 4;
        g.rect(x - 2, 2, w + 4, 3).fill(0x6b4a2e); // mantel
        g.rect(x, 5, w, 27).fill(0x8a8a8a);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) g.rect(x + c * 10 + (r % 2) * 5, 5 + r * 7, 9, 6).fill(0x9a9a9a);
        g.rect(x + 8, 14, w - 16, 18).fill(0x1a1010);
        for (let i = 0; i < 5; i++) {
          const fh = 6 + 5 * Math.abs(Math.sin(t / 120 + i * 1.7));
          g.rect(x + 10 + i * 4.5, 32 - fh, 4, fh).fill(i % 2 ? 0xffb020 : 0xff6a20);
        }
        g.circle(x + w / 2, 3 * T, 26).fill({ color: 0xff8030, alpha: 0.1 + 0.03 * Math.sin(t / 150) });
      });
    case "stage":
      return anim((g, t) => {
        const x0 = 4.5 * T, w = 7 * T, y1 = 3.7 * T;
        g.rect(x0, 2 * T, w, y1 - 2 * T).fill(0x7a4a26);
        for (let y = 2 * T + 6; y < y1; y += 6) g.rect(x0, y, w, 1).fill(0x5e381c);
        g.rect(x0, y1, w, 3).fill(0x4a2c14).rect(x0, y1 + 3, w, 2).fill({ color: 0x000000, alpha: 0.25 });
        g.circle(8 * T, 2.9 * T, 22).fill({ color: 0xfff0b0, alpha: 0.12 + 0.03 * Math.sin(t / 700) }); // spotlight on the big desk
      });
  }
}

/** One worker's job (site or factory), 2 tiles wide on the row (wx, wy); animated while `on`, `p` = per-spot phase. */
export function drawJob(g: Graphics, job: Job, wx: number, wy: number, t: number, on: boolean, p: number) {
  const W = 2 * T, base = wy + T - 2;
  const blink = on && Math.floor(t / 120 + p) % 2 === 1;
  g.clear().rect(wx, base, W, 2).fill(0x6e6a64); // footing
  switch (job) {
    case "bricks": {
      const n = on ? Math.min(16, Math.floor(t / 500 + p) % 22) : 6;
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / 4), col = i % 4, odd = row % 2 === 1;
        // odd courses are staggered: three full bricks and a half brick at the left end
        const [bx, bw] = odd ? (col === 3 ? [0, 3] : [col * 8 + 4, 7]) : [col * 8, 7];
        g.rect(wx + bx, base - 4 - row * 4, bw, 3).fill(odd ? 0xb5523b : 0xa8472f);
      }
      if (blink && n < 16) g.rect(wx + (n % 4) * 8 + 3, base - 6 - Math.floor(n / 4) * 4, 2, 1).fill(0xffe066);
      break;
    }
    case "weld": { // steel I-beam on two trestles, a torch walking along the seam
      for (const lx of [wx + 4, wx + W - 6]) g.rect(lx, base - 6, 2, 6).fill(0x5a5a60);
      g.rect(wx + 1, base - 12, W - 2, 2).fill(0x8a929c).rect(wx + 1, base - 10, W - 2, 3).fill(0x6a727c).rect(wx + 1, base - 7, W - 2, 2).fill(0x8a929c);
      if (on) {
        const sx = wx + 3 + ((t / 30 + p * 5) % (W - 6));
        g.circle(sx, base - 9, 5).fill({ color: 0x9ad0ff, alpha: 0.25 }).rect(sx - 1, base - 10, 2, 2).fill(0xffffff);
        for (let k = 0; k < 4; k++) g.rect(sx + Math.sin(t / 50 + k * 1.7) * 5, base - 10 - Math.abs(Math.cos(t / 70 + k)) * 6, 1, 1).fill(k % 2 ? 0xffe066 : 0xff9a30);
      }
      break;
    }
    case "mixer": { // cement mixer, the drum turns while working
      const cx = wx + 14, cy = base - 8, a = on ? t / 250 : p;
      g.rect(wx + 6, base - 3, 2, 3).fill(0x444444).rect(wx + 20, base - 3, 2, 3).fill(0x444444);
      g.circle(cx, cy, 7).fill(0xe07a20).circle(cx, cy, 7).stroke({ color: 0x8a4a10, width: 1 });
      for (let k = 0; k < 3; k++) {
        const ang = a + (k * 2 * Math.PI) / 3;
        g.moveTo(cx, cy).lineTo(cx + Math.cos(ang) * 6, cy + Math.sin(ang) * 6).stroke({ color: 0x8a4a10, width: 1 });
      }
      g.rect(wx + 22, base - 9, 8, 7).fill(0x9a9690); // cement bags
      if (on && blink) g.rect(cx + 7, cy - 1, 2, 2).fill(0xbdb8b0);
      break;
    }
    case "saw": { // plank on sawhorses, the saw goes back and forth and sawdust falls
      for (const lx of [wx + 4, wx + W - 6]) g.moveTo(lx, base).lineTo(lx + 2, base - 7).lineTo(lx + 4, base).stroke({ color: 0x7a5a3a, width: 1 });
      g.rect(wx, base - 10, W, 3).fill(0xc89a5a).rect(wx, base - 10, W, 1).fill(0xe0b878);
      const sx = wx + 16 + (on ? Math.sin(t / 90) * 4 : 0);
      g.rect(sx, base - 16, 1, 9).fill(0xc0c4c8).rect(sx - 1, base - 18, 3, 3).fill(0x7a3a2a);
      if (on) for (let k = 0; k < 3; k++) g.rect(wx + 16 + k * 2 - 2, base - 6 + ((t / 60 + k * 4) % 6), 1, 1).fill(0xe0c890);
      break;
    }
    case "paint": { // a plastered wall section, painted blue left to right with a roller
      g.rect(wx + 1, base - 15, W - 2, 15).fill(0xd8d2c4);
      const done = on ? ((t / 80 + p * 10) % (W + 10)) : W * 0.4;
      const pw = Math.min(W - 2, done);
      g.rect(wx + 1, base - 15, pw, 15).fill(0x4a8ad0);
      if (pw < W - 2) g.rect(wx + 1 + pw - 1, base - 15 + (on ? Math.abs(Math.sin(t / 150)) * 10 : 5), 3, 4).fill(0xf0f0f0);
      g.rect(wx + W - 6, base - 3, 5, 3).fill(0x3a6aa0); // paint tin
      break;
    }
    case "drill": { // rubble pile under a jackhammer, dust while working
      const shake = on ? Math.sin(t / 25) : 0;
      for (const [rx, ry, r, c] of [[8, 3, 4, 0x8a8478], [15, 4, 5, 0x9a9488], [23, 3, 4, 0x7a746a]] as const) g.circle(wx + rx + shake * 0.5, base - ry, r).fill(c);
      g.rect(wx + 15 + shake, base - 14, 2, 8).fill(0x3a3a3a).rect(wx + 12 + shake, base - 16, 8, 2).fill(0xf2c200);
      if (on) for (let k = 0; k < 3; k++) g.circle(wx + 10 + k * 6, base - 6 - ((t / 70 + k * 3) % 6), 1.5).fill({ color: 0xd8d0c0, alpha: 0.6 });
      break;
    }
    case "press": { // hydraulic press stamping a sheet
      const ram = on ? Math.abs(Math.sin(t / 250 + p)) * 7 : 2;
      g.rect(wx + 4, base - 17, 3, 17).fill(0x4a5a6a).rect(wx + 25, base - 17, 3, 17).fill(0x4a5a6a).rect(wx + 4, base - 19, 24, 3).fill(0x3a4a5a);
      g.rect(wx + 14, base - 16, 4, 3 + ram).fill(0xa0a8b0).rect(wx + 10, base - 13 + ram, 12, 4).fill(0x6a727c);
      g.rect(wx + 8, base - 3, 16, 2).fill(0xd0d4d8);
      if (on && ram > 6.5) g.rect(wx + 9, base - 4, 1, 1).fill(0xffe066).rect(wx + 22, base - 5, 1, 1).fill(0xffe066);
      break;
    }
    case "lathe": { // lathe turning a bar, sparks off the tool
      g.rect(wx + 1, base - 6, W - 2, 5).fill(0x2f5a46).rect(wx + 1, base - 13, 7, 7).fill(0x3a6a54);
      const spin = on ? Math.floor(t / 40) % 4 : 0;
      g.rect(wx + 8, base - 11, 18, 3).fill(0xb8bcc0);
      for (let i = 0; i < 5; i++) g.rect(wx + 9 + i * 4 + spin, base - 11, 1, 3).fill(0x80868c);
      g.rect(wx + 26, base - 12, 3, 5).fill(0x3a6a54).rect(wx + 18, base - 8, 3, 2).fill(0x222222);
      if (on) for (let k = 0; k < 3; k++) g.rect(wx + 20 + Math.sin(t / 40 + k * 2) * 3, base - 7 + Math.abs(Math.cos(t / 60 + k)) * 5, 1, 1).fill(0xffb030);
      break;
    }
    case "pack": { // cardboard box, flaps open and close, tape on the bench
      g.rect(wx + 1, base - 5, W - 2, 5).fill(0x8a6a4a);
      const flap = on ? Math.abs(Math.sin(t / 400 + p)) * 5 : 4;
      g.rect(wx + 8, base - 15, 16, 10).fill(0xc8a060).rect(wx + 8, base - 15, 16, 1).fill(0xa8803c);
      g.rect(wx + 8, base - 15 - flap, 2, flap).fill(0xd8b070).rect(wx + 22, base - 15 - flap, 2, flap).fill(0xd8b070);
      g.rect(wx + 15, base - 15, 2, 10).fill(0xb89050);
      g.circle(wx + 28, base - 7, 2).fill(0xe0e0d0); // tape roll
      break;
    }
    case "robot": { // orange robot arm swinging between two points
      const a = on ? -1.9 + Math.sin(t / 450 + p) * 0.8 : -1.6;
      const sx = wx + 16, sy = base - 5, ex = sx + Math.cos(a) * 9, ey = sy + Math.sin(a) * 9, b = a + 1.3;
      const hx = ex + Math.cos(b) * 7, hy = ey + Math.sin(b) * 7;
      g.rect(wx + 11, base - 4, 10, 4).fill(0x3a3a3a);
      g.moveTo(sx, sy).lineTo(ex, ey).stroke({ color: 0xe07a20, width: 3 }).moveTo(ex, ey).lineTo(hx, hy).stroke({ color: 0xe07a20, width: 2 });
      g.circle(ex, ey, 1.5).fill(0x3a3a3a).rect(hx - 2, hy - 1, 4, 2).fill(0x8a8a8a);
      break;
    }
    case "furnace": { // brick furnace with a flickering mouth
      g.rect(wx + 4, base - 17, 24, 17).fill(0x5a4a44);
      for (let r = 0; r < 4; r++) g.rect(wx + 4, base - 17 + r * 4, 24, 1).fill(0x4a3a34);
      const f = on ? 0.6 + 0.4 * Math.abs(Math.sin(t / 90 + p)) : 0.25;
      g.rect(wx + 10, base - 11, 12, 8).fill(0x1a0e0a).rect(wx + 11, base - 9, 10, 6).fill({ color: 0xff8a20, alpha: f });
      if (on) g.circle(wx + 16, base - 7, 10).fill({ color: 0xff8030, alpha: 0.12 * f });
      break;
    }
    case "crates": { // stacking wooden crates, one at a time
      const n = on ? Math.floor(t / 700 + p) % 7 : 2;
      const pos = [[1, 0], [11, 0], [21, 0], [6, 1], [16, 1], [11, 2]];
      for (let i = 0; i < Math.min(n, pos.length); i++) {
        const [cx, row] = pos[i];
        g.rect(wx + cx, base - 7 - row * 7, 10, 7).fill(0xa8783c).rect(wx + cx, base - 7 - row * 7, 10, 1).fill(0xc8984c)
          .rect(wx + cx + 4, base - 7 - row * 7, 1, 7).fill(0x7a5428);
      }
      break;
    }
  }
}

/** Set pieces drawn on top of the furniture (e.g. flasks standing on a table). */
export function decorOver(kind: Decor, anim: Anim) {
  if (kind !== "flasks") return;
  anim((g, t) => {
    [[7.3, 0x5cff8a], [8, 0x8fd6ff], [8.7, 0xff8fa3]].forEach(([fx, c], i) => {
      const x = fx * T, y = 3 * T + 3;
      g.rect(x - 2, y - 7, 4, 4).fill({ color: 0xffffff, alpha: 0.5 });
      g.moveTo(x - 2, y - 3).lineTo(x - 5, y + 4).lineTo(x + 5, y + 4).lineTo(x + 2, y - 3).closePath().fill({ color: 0xffffff, alpha: 0.55 });
      g.moveTo(x - 3.5, y + 1).lineTo(x - 5, y + 4).lineTo(x + 5, y + 4).lineTo(x + 3.5, y + 1).closePath().fill(c);
      for (let b = 0; b < 2; b++) {
        const p = ((t / 900 + i * 0.3 + b * 0.5) % 1);
        g.circle(x - 1 + b * 2, y + 2 - p * 10, 0.8).fill({ color: c, alpha: 1 - p });
      }
    });
  });
}
