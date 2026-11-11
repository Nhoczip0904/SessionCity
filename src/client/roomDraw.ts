import { Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";
import type { Pt } from "./path.js";
import { ROOM_COLS, ROOM_ROWS, type Furniture, type RoomTheme } from "./rooms.js";
import * as K from "./tiles.js";
import type { Sheets } from "./tiles.js";

const T = 16;
const TEXT = {
  style: { fontFamily: 'Consolas, "DejaVu Sans Mono", "Courier New", monospace', fontSize: 7, fill: 0xffffff, stroke: { color: 0x111111, width: 2 } },
  resolution: 4,
  textureStyle: { scaleMode: "linear" as const },
};
const label = (text: string) => new Text({ text, ...TEXT });
const darker = (c: number) => ((c >> 16) * 0.92 << 16) | (((c >> 8) & 255) * 0.92 << 8) | ((c & 255) * 0.92) & 0xffffff;

const BOARD_CHARS = 54; // ≈ (room width − margin) / glyph width of the 7 px monospace font

/** At most 3 lines, each cut with "…" to fit the wall band. */
export const fitBoard = (lines: string[], max = BOARD_CHARS) =>
  lines.slice(0, 3).map((l) => (l.length > max ? l.slice(0, max - 1) + "…" : l));

export interface Seat { at: Pt; big?: boolean; fig: Container | null; label: string; badge: string; done: boolean; onPick: () => void }

export function drawRoom(sheets: Sheets | null, theme: RoomTheme, seats: Seat[], board: string[], note: string | null, onFurniture: (f: Furniture) => void): Container {
  const root = new Container();
  const ind = sheets?.indoor;
  const g = new Graphics();
  g.rect(0, 0, ROOM_COLS * T, 2 * T).fill(theme.wall);
  for (let y = 2; y < ROOM_ROWS; y++) for (let x = 0; x < ROOM_COLS; x++) g.rect(x * T, y * T, T, T).fill((x + y) % 2 ? darker(theme.floor) : theme.floor);
  g.rect(7 * T, (ROOM_ROWS - 1) * T, 2 * T, T).fill(0x3a2a1a); // door
  root.addChild(g);

  const tile = (i: number, x: number, y: number, fallback: number) => {
    if (ind) {
      const s = new Sprite(ind(i));
      s.position.set(x * T, y * T);
      root.addChild(s);
    } else root.addChild(new Graphics().rect(x * T, y * T, T, T).fill(fallback));
  };

  for (const p of theme.props) {
    const box = new Container();
    root.addChild(box);
    const at = (i: number, x: number, y: number, fb: number) => {
      const before = root.children.length;
      tile(i, x, y, fb);
      box.addChild(root.children[before]);
    };
    p.tiles.forEach((t, i) => at(t, p.x + (i % p.w), p.y + Math.floor(i / p.w), p.action ? 0xb08a4a : 0x7a6a50));
    if (p.action) {
      const f = p.action;
      box.eventMode = "static";
      box.cursor = "pointer";
      box.hitArea = new Rectangle(p.x * T, p.y * T, p.w * T, Math.ceil(p.tiles.length / p.w) * T);
      box.on("pointertap", () => onFurniture(f));
      if (p.name) {
        const t = label(p.name);
        t.anchor.set(0.5, 1);
        t.position.set((p.x + p.w / 2) * T, p.y * T + 1);
        t.visible = false;
        box.on("pointerover", () => (t.visible = true));
        box.on("pointerout", () => (t.visible = false));
        root.addChild(t);
      }
    }
  }

  const lines = fitBoard(board);
  lines.forEach((l, i) => {
    const t = label(l);
    t.style.fontSize = 7;
    t.position.set(4, 2 + i * 9);
    root.addChild(t);
  });

  for (const s of seats) {
    const { x, y } = s.at;
    const w = s.big ? 3 : 1;
    const seat = new Container();
    root.addChild(seat);
    const sub = (c: Container) => seat.addChild(c);
    const before = root.children.length;
    (s.big ? K.IN_BIG_DESK : [K.IN_DESK]).forEach((i, n) => tile(i, x + n, y, 0x8b5a2b));
    tile(K.IN_CHAIR, x + (w - 1) / 2 | 0, y + 1, 0x555555);
    for (const c of root.children.slice(before)) sub(c);
    if (s.fig && !s.done) {
      s.fig.position.set(((x + (w - 1) / 2 | 0) + 0.5) * T, (y + 2) * T);
      sub(s.fig);
    }
    const t = label(s.done ? `✓ ${s.label}` : `${s.badge ? s.badge + " " : ""}${s.label}`);
    t.anchor.set(0.5, 0.5);
    t.position.set((x + w / 2) * T, y * T + T / 2);
    sub(t);
    seat.eventMode = "static";
    seat.cursor = "pointer";
    seat.hitArea = new Rectangle(x * T, y * T, w * T, 2 * T);
    seat.on("pointertap", s.onPick);
  }

  if (note) {
    const t = label(note);
    t.anchor.set(0.5, 1);
    t.position.set((ROOM_COLS * T) / 2, (ROOM_ROWS - 1) * T - 2);
    root.addChild(t);
  }
  return root;
}
