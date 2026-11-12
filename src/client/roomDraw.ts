import { Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";
import type { Pt } from "./path.js";
import { decorOver, decorUnder, type Anim } from "./roomDecor.js";
import { BOARD_W, BOARD_X, MAX_DESKS, ROOM_COLS, ROOM_ROWS, deskSpots, type Furniture, type RoomTheme } from "./rooms.js";
import * as K from "./tiles.js";
import type { Sheets } from "./tiles.js";

const T = 16;
const W = ROOM_COLS * T, H = ROOM_ROWS * T, WALL = 2 * T;
const FONT = 'Consolas, "DejaVu Sans Mono", "Courier New", monospace';
const TEXT = {
  style: { fontFamily: FONT, fontSize: 7, fill: 0xffffff, stroke: { color: 0x111111, width: 2 } },
  resolution: 4,
  textureStyle: { scaleMode: "linear" as const },
};
const label = (text: string) => new Text({ text, ...TEXT });
const boardText = (text: string) => new Text({ text, style: { fontFamily: FONT, fontSize: 7, fill: 0x2b2118 }, resolution: 4, textureStyle: { scaleMode: "linear" } });

/** k > 0 mixes toward white, k < 0 scales toward black. */
const shade = (c: number, k: number) =>
  [16, 8, 0].reduce((out, s) => {
    const v = (c >> s) & 255;
    return out | (Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)) << s);
  }, 0);
const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000 / 1000;

const BOARD_CHARS = 41; // ≈ board inner width (BOARD_W·16 − 10 px) / glyph advance of the 7 px font, checked in the browser

/** At most 3 lines, each cut with "…" to fit the board on the wall. */
export const fitBoard = (lines: string[], max = BOARD_CHARS) =>
  lines.slice(0, 3).map((l) => (l.length > max ? l.slice(0, max - 1) + "…" : l));

/** `at` is the chair tile: a 2-wide desk sits at x..x+1 on the row below, or above when `back` (big: 3-wide, centred on the chair). */
export interface Seat { at: Pt & { back?: boolean }; big?: boolean; fig: Container | null; label: string; badge: string; done: boolean; onPick: () => void }

function drawFloor(g: Graphics, theme: RoomTheme) {
  const base = theme.floor;
  for (let y = 2; y < ROOM_ROWS; y++) {
    for (let x = 0; x < ROOM_COLS; x++) {
      const px = x * T, py = y * T;
      if (theme.kind === "wood") {
        // two planks per tile row, seams staggered per plank
        for (let p = 0; p < 2; p++) {
          const k = (hash(x + (p ? 7 : 0), y) - 0.5) * 0.12;
          g.rect(px, py + p * 8, T, 8).fill(shade(base, k));
          g.rect(px, py + p * 8 + 7, T, 1).fill(shade(base, -0.25));
          if ((x + y * 3 + p * 2) % 4 === 0) g.rect(px, py + p * 8, 1, 7).fill(shade(base, -0.2));
        }
      } else if (theme.kind === "tile") {
        g.rect(px, py, T, T).fill(shade(base, (x + y) % 2 ? -0.05 : 0.04));
        g.rect(px, py, T, 1).fill(shade(base, 0.18)).rect(px, py, 1, T).fill(shade(base, 0.18));
        g.rect(px + T - 1, py, 1, T).fill(shade(base, -0.15)).rect(px, py + T - 1, T, 1).fill(shade(base, -0.15));
      } else {
        g.rect(px, py, T, T).fill(shade(base, (hash(x, y) - 0.5) * 0.06));
        for (let i = 0; i < 3; i++) g.rect(px + ((hash(x * 3 + i, y) * 15) | 0), py + ((hash(x, y * 5 + i) * 15) | 0), 1, 1).fill(shade(base, -0.18));
        if (x % 4 === 0) g.rect(px, py, 1, T).fill(shade(base, -0.12));
      }
    }
  }
  for (const [x, y, w, h, c] of theme.rugs ?? []) {
    const px = x * T, py = y * T, pw = w * T, ph = h * T;
    g.rect(px + 1, py + 2, pw, ph).fill({ color: 0x000000, alpha: 0.2 });
    g.rect(px, py, pw, ph).fill(c);
    g.rect(px + 3, py + 3, pw - 6, ph - 6).stroke({ color: shade(c, 0.35), width: 1 });
    g.rect(px + 6, py + 6, pw - 12, ph - 12).fill(shade(c, -0.12));
  }
  if (theme.runner !== undefined) {
    const r = theme.runner;
    g.rect(7 * T - 2, 3 * T, 2 * T + 4, H - 3 * T).fill(r);
    g.rect(7 * T - 2, 3 * T, 2, H - 3 * T).fill(0xd8b04a).rect(9 * T, 3 * T, 2, H - 3 * T).fill(0xd8b04a);
  }
}

function drawWalls(g: Graphics, theme: RoomTheme) {
  const w = theme.wall;
  g.rect(0, 0, W, WALL).fill(w);
  g.rect(0, 0, W, 3).fill(shade(w, -0.35)); // ceiling trim
  g.rect(0, 20, W, 10).fill(shade(w, -0.12)); // wainscot
  g.rect(0, 19, W, 1).fill(shade(w, 0.3));
  g.rect(0, 30, W, 2).fill(shade(w, -0.45)); // skirting
  g.rect(0, WALL, W, 4).fill({ color: 0x000000, alpha: 0.18 }); // shadow cast by the wall
  // side walls and the front wall with the door gap
  g.rect(0, WALL, 3, H - WALL).fill(shade(w, -0.3)).rect(W - 3, WALL, 3, H - WALL).fill(shade(w, -0.3));
  g.rect(0, H - 3, 7 * T, 3).fill(shade(w, -0.3)).rect(9 * T, H - 3, W - 9 * T, 3).fill(shade(w, -0.3));
  g.rect(7 * T, H - 6, 2 * T, 6).fill(0x5a3e28).rect(7 * T + 2, H - 5, 2 * T - 4, 4).fill(0x7a5638); // door mat
  for (const x of theme.windows) {
    const px = x * T + 3, pw = 2 * T - 6;
    g.rect(px - 1, 4, pw + 2, 15).fill(shade(w, -0.5));
    g.rect(px, 5, pw, 13).fill(0x9fd3ef).rect(px, 5, pw, 4).fill(0xc9ecfb);
    g.rect(px + pw / 2 - 0.5, 5, 1, 13).fill(shade(w, -0.5)).rect(px, 11, pw, 1).fill(shade(w, -0.5));
    g.rect(px - 2, 18, pw + 4, 2).fill(shade(w, 0.2)); // sill
  }
}

function drawBoard(root: Container, lines: string[]) {
  const g = new Graphics();
  const x = BOARD_X * T + 2, w = BOARD_W * T - 4;
  g.rect(x + 1, 4, w, 27).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(x, 3, w, 27).fill(0x5a3e28).rect(x + 2, 5, w - 4, 23).fill(0xf6f1e3);
  root.addChild(g);
  lines.forEach((l, i) => {
    const t = boardText(l);
    t.position.set(x + 5, 5 + i * 7.5);
    root.addChild(t);
  });
}

/** Coloured status lights on server racks, blinking at their own pace. */
function leds(root: Container, spots: Pt[]) {
  if (!spots.length) return;
  const g = new Graphics();
  const dots = spots.flatMap((p, n) => [0, 1, 2].map((i) => ({ x: p.x * T + 10, y: p.y * T + 4 + i * 4, c: [0x55ff77, 0xffcc33, 0x55ff77][i], phase: hash(n, i) * 6 })));
  const paint = (t: number) => {
    g.clear();
    for (const d of dots) g.rect(d.x, d.y, 2, 1).fill({ color: d.c, alpha: Math.sin(t / 300 + d.phase) > -0.2 ? 1 : 0.15 });
  };
  paint(0);
  g.onRender = () => paint(performance.now());
  root.addChild(g);
}

export function drawRoom(sheets: Sheets | null, theme: RoomTheme, seats: Seat[], board: string[], note: string | null, onFurniture: (f: Furniture) => void): Container {
  const root = new Container();
  const ind = sheets?.indoor;
  const bg = new Graphics();
  drawFloor(bg, theme);
  drawWalls(bg, theme);
  root.addChild(bg);

  const anim: Anim = (draw) => {
    const g = new Graphics();
    g.eventMode = "none";
    draw(g, 0);
    g.onRender = () => {
      g.clear();
      draw(g, performance.now());
    };
    root.addChild(g);
  };
  const sprite = (i: number, px: number, py: number, fallback: number, city = false): Container => {
    const tex = city ? sheets?.city(i) : ind?.(i);
    if (tex) {
      const s = new Sprite(tex);
      s.position.set(px, py);
      return s;
    }
    return new Graphics().rect(px + 1, py + 1, T - 2, T - 2).fill(fallback);
  };
  if (theme.decor) decorUnder(theme.decor, anim);
  const shadow = new Graphics();
  root.addChild(shadow);
  const blob = (cx: number, cy: number, rx: number) => shadow.ellipse(cx, cy, rx, 2.5).fill({ color: 0x000000, alpha: 0.22 });

  drawBoard(root, fitBoard(board));

  const ledSpots: Pt[] = [];
  for (const p of theme.props) {
    const box = new Container();
    const rows = Math.ceil(p.tiles.length / p.w);
    p.tiles.forEach((t, i) => box.addChild(sprite(t, (p.x + (i % p.w)) * T, (p.y + Math.floor(i / p.w)) * T, p.action ? 0xb08a4a : 0x7a6a50, p.city)));
    if (p.y >= 2) blob((p.x + p.w / 2) * T, (p.y + rows) * T - 1, p.w * T * 0.45);
    if (p.leds) ledSpots.push({ x: p.x, y: p.y });
    root.addChild(box);
    if (p.action) {
      const f = p.action;
      box.eventMode = "static";
      box.cursor = "pointer";
      box.hitArea = new Rectangle(p.x * T, p.y * T, p.w * T, rows * T);
      box.on("pointertap", () => onFurniture(f));
      if (p.name) {
        const t = label(p.name);
        t.anchor.set(0.5, 1);
        t.position.set((p.x + p.w / 2) * T, p.y * T + 1);
        t.visible = false;
        t.zIndex = 10;
        box.on("pointerover", () => (t.visible = true));
        box.on("pointerout", () => (t.visible = false));
        root.addChild(t);
      }
    }
  }
  leds(root, ledSpots);
  if (theme.decor) decorOver(theme.decor, anim);

  /** Chair, desk and screen; the person (if any) sits between chair and desk. In a hall only the big desk has one. */
  const desk = theme.desk ?? { tiles: K.IN_DESK, monitor: true };
  const hall = theme.layout === "hall", lounge = theme.layout === "lounge", site = theme.layout === "site";
  const span = (big: boolean) => (big ? { left: -1, w: 3 } : hall || lounge ? { left: 0, w: 1 } : { left: 0, w: 2 });
  const station = (x: number, y: number, big: boolean, fig: Container | null, on: boolean, back = false): Container => {
    const { w } = span(big), left = x + span(big).left;
    const cx = (left + w / 2) * T;
    const c = new Container();
    if (hall && !big) {
      blob(cx, (y + 1) * T - 1, T * 0.45);
      c.addChild(sprite(K.IN_CHAIR, cx - T / 2, y * T + 2, 0x555555));
      if (fig) {
        fig.position.set(Math.round(cx), (y + 1) * T - 1);
        c.addChild(fig);
      }
      return c;
    }
    if (site) {
      // a builder in a hard hat behind a 2-wide brick wall; while working the bricks go up one by one
      blob(cx, (y + 2) * T - 1, w * T * 0.45);
      if (fig) {
        fig.position.set(Math.round(cx), (y + 1) * T + 6);
        const top = fig.y - fig.height;
        c.addChild(fig, new Graphics().rect(cx - 4, top - 1, 8, 3).fill(0xf2c200).rect(cx - 5, top + 1, 10, 1).fill(0xc89a00));
      }
      const wall = new Graphics();
      wall.eventMode = "none";
      const wx = left * T, wy = (y + 1) * T, phase = (x * 7 + y * 3) % 16;
      const bricks = (n: number, t: number) => {
        wall.clear().rect(wx, wy + T - 2, w * T, 2).fill(0x6e6a64); // footing
        for (let i = 0; i < n; i++) {
          const row = Math.floor(i / 4), col = i % 4, odd = row % 2 === 1;
          // odd courses are staggered: three full bricks and a half brick at the left end
          const [bx, bw] = odd ? (col === 3 ? [0, 3] : [col * 8 + 4, 7]) : [col * 8, 7];
          wall.rect(wx + bx, wy + T - 6 - row * 4, bw, 3).fill(odd ? 0xb5523b : 0xa8472f);
        }
        if (on && n < 16 && Math.floor(t / 120) % 2) { // sparks where the next brick goes
          const row = Math.floor(n / 4), col = n % 4;
          wall.rect(wx + col * 8 + 3, wy + T - 8 - row * 4, 1, 1).fill(0xffe066).rect(wx + col * 8 + 5, wy + T - 9 - row * 4, 1, 1).fill(0xffffff);
        }
      };
      if (on) wall.onRender = () => { const t = performance.now(); bricks(Math.min(16, Math.floor(t / 500 + phase) % 22), t); };
      bricks(on ? phase : 6, 0); // empty spot: a half-built wall
      c.addChild(wall);
      return c;
    }
    if (lounge) {
      // armchair: back on row y-1, seat on row y; the person sits between them
      blob(cx, (y + 1) * T - 1, T * 0.5);
      c.addChild(sprite(K.IN_ARMCHAIR[0], left * T, (y - 1) * T, 0x7a3a2a));
      if (fig) {
        fig.position.set(Math.round(cx), y * T + 10);
        c.addChild(fig);
      }
      c.addChild(sprite(K.IN_ARMCHAIR[1], left * T, y * T, 0x7a3a2a));
      return c;
    }
    const deskTiles = big ? K.IN_BIG_DESK : desk.tiles;
    const mx = (left + w - 1) * T + 2;
    // a bit of clutter: papers or a mug beside the screen
    const clutter = (dy: number) => {
      const g = new Graphics();
      if ((x + y) % 2) g.rect(left * T + 4, dy, 7, 5).fill(0xf4f1e8).rect(left * T + 6, dy - 1, 7, 5).fill(0xffffff).stroke({ color: 0xcfc8b8, width: 0.5 });
      else g.rect(left * T + 6, dy, 4, 5).fill(0xe8e8e8).rect(left * T + 10, dy + 1, 1.5, 2).fill(0xe8e8e8).rect(left * T + 6.5, dy + 0.5, 3, 1).fill(0x6b3a1e);
      return g;
    };
    if (back) {
      // facing up: desk above, screen seen from the front, the person's back to us
      blob(cx, (y + 1) * T - 1, w * T * 0.45);
      deskTiles.forEach((i, n) => c.addChild(sprite(i, (left + n) * T, (y - 1) * T, 0x8b5a2b)));
      const m = sprite(K.IN_MONITOR, mx, (y - 1) * T - 4, 0x333333);
      if (!on && m instanceof Sprite) m.tint = 0x707070;
      c.addChild(m, clutter((y - 1) * T + 4));
      if (fig) {
        fig.position.set(Math.round(cx), y * T + 10); // only the top of the head shows over the chair back
        c.addChild(fig);
      }
      c.addChild(sprite(K.IN_CHAIR_BACK, cx - T / 2, y * T - 3, 0x555555));
      return c;
    }
    blob(cx, (y + 2) * T - 1, w * T * 0.45);
    c.addChild(sprite(K.IN_CHAIR, cx - T / 2, y * T + 2, 0x555555));
    if (fig) {
      fig.position.set(Math.round(cx), (y + 1) * T + 5); // legs hidden behind the desk
      c.addChild(fig);
    }
    deskTiles.forEach((i, n) => c.addChild(sprite(i, (left + n) * T, (y + 1) * T, 0x8b5a2b)));
    if (big) {
      const m = sprite(K.IN_MONITOR, mx, (y + 1) * T - 6, 0x333333);
      if (!on && m instanceof Sprite) m.tint = 0x707070; // screen off
      c.addChild(m);
    } else {
      // facing down: we see the back of the screen, at the desk edge it shares with the one opposite
      c.addChild(new Graphics().rect(mx + 2, (y + 1) * T + 4, 12, 9).fill(0x3a3f48).rect(mx + 3, (y + 1) * T + 5, 10, 1).fill(0x59606c)
        .rect(mx + 7, (y + 1) * T + 13, 2, 3).fill(0x2a2e35));
    }
    if (!big) c.addChild(clutter((y + 1) * T + 6));
    return c;
  };

  // every workstation is there, taken or not
  const taken = new Set(seats.map((s) => `${s.at.x},${s.at.y}`));
  for (const p of deskSpots(MAX_DESKS, theme.layout)) if (!taken.has(`${p.x},${p.y}`)) root.addChild(station(p.x, p.y, !!p.big, null, false, p.back));

  for (const s of seats) {
    const { x, y } = s.at;
    const { w } = span(!!s.big), left = x + span(!!s.big).left;
    const cx = (left + w / 2) * T;
    const back = !!s.at.back;
    const seat = station(x, y, !!s.big, s.fig && !s.done ? s.fig : null, !s.done, back);
    const max = s.big || hall ? 14 : 8; // pod neighbours sit only 2 tiles apart
    const name = s.label.length > max ? s.label.slice(0, max - 1) + "…" : s.label;
    const t = label(s.done ? `✓ ${name}` : `${s.badge ? s.badge + " " : ""}${name}`);
    t.anchor.set(0.5, back ? 0 : 1);
    t.position.set(cx, back ? (y + 1) * T - 2 : lounge ? (y - 1) * T + 2 : y * T + 2);
    if (s.done) t.alpha = 0.7;
    seat.addChild(t);
    seat.eventMode = "static";
    seat.cursor = "pointer";
    seat.hitArea = lounge ? new Rectangle(left * T, (y - 1) * T - 6, w * T, 2 * T + 6) : back ? new Rectangle(left * T, (y - 1) * T, w * T, 2 * T + 8) : new Rectangle(left * T, y * T - 6, w * T, 2 * T + 6);
    seat.on("pointertap", s.onPick);
    root.addChild(seat);
  }

  if (note) {
    const t = label(note);
    t.anchor.set(0.5, 1);
    t.position.set(W / 2, H - 8);
    root.addChild(t);
  }

  const v = new Graphics();
  v.eventMode = "none";
  if (theme.tint) v.rect(0, 0, W, H).fill({ color: theme.tint[0], alpha: theme.tint[1] });
  // soft vignette: darker towards the front corners
  for (let i = 0; i < 4; i++) {
    const a = 0.05;
    v.rect(0, WALL + i * 4, 6 + i * 4, H).fill({ color: 0x000000, alpha: a });
    v.rect(W - 6 - i * 4, WALL + i * 4, 6 + i * 4, H).fill({ color: 0x000000, alpha: a });
    v.rect(0, H - 6 - i * 4, W, 6 + i * 4).fill({ color: 0x000000, alpha: a });
  }
  root.addChild(v);
  root.sortableChildren = true;
  return root;
}
