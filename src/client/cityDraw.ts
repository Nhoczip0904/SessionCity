import { Container, Graphics, Sprite } from "pixi.js";
import type { District } from "../shared/types.js";
import * as K from "./tiles.js";
import type { Sheets } from "./tiles.js";
import { onRoad, type Road } from "./roads.js";

const T = 16;

export interface MapLayout {
  cols: number;
  rows: number;
  isRoad(x: number, y: number): boolean;
  isPath(x: number, y: number): boolean;
  isRiver(x: number, y: number): boolean;
  roads: Road[];
  plots: { id: District; x: number; y: number; w: number; h: number; up: boolean }[];
  hall: { x: number; y: number; w: number; h: number };
  hq: { x: number; y: number; up: boolean; h?: number; side?: number }[];
  built: Set<number>;
  hash(x: number, y: number): number;
}

type Put = (i: number, x: number, y: number) => void;

/** Draws ground, roads, buildings and props from the Kenney sheet; labels are added by the caller. */
export function drawTiles(s: Sheets, m: MapLayout): Container {
  const root = new Container();
  const fx = new Graphics(); // small non-tile details (flags, antennas, chimneys) on top
  const put: Put = (i, x, y) => {
    const sp = new Sprite(s.city(i));
    sp.position.set(x * T, y * T);
    root.addChild(sp);
  };
  const { cols, rows, isRoad, hash } = m;
  const hRoad = (x: number, y: number) => m.roads.find((r) => r.w > r.h && onRoad(r, x, y));
  const vRoad = (x: number, y: number) => m.roads.find((r) => r.w < r.h && onRoad(r, x, y));
  const isH = (x: number, y: number) => !!hRoad(x, y);
  const isV = (x: number, y: number) => !!vRoad(x, y);
  const builtAt = (x: number, y: number) => m.built.has(y * cols + x);

  // ground: roads, sidewalk ring around each block, grass elsewhere; the river is drawn beneath
  const sidewalk = new Set<number>();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (m.isRiver(x, y) && !isRoad(x, y)) continue;
      if (isRoad(x, y)) {
        put(roadTile(x, y), x, y);
        continue;
      }
      if (m.isPath(x, y)) {
        put(K.SIDEWALK, x, y);
        continue;
      }
      const n = isRoad(x, y - 1), so = isRoad(x, y + 1), w = isRoad(x - 1, y), e = isRoad(x + 1, y);
      const diag = isRoad(x - 1, y - 1) || isRoad(x + 1, y - 1) || isRoad(x - 1, y + 1) || isRoad(x + 1, y + 1);
      if (!(n || so || w || e || diag)) {
        put(K.GRASS[hash(x, y) % K.GRASS.length], x, y);
        continue;
      }
      sidewalk.add(y * cols + x);
      put(
        n && w ? K.SIDEWALK_NW : n && e ? K.SIDEWALK_NE : so && w ? K.SIDEWALK_SW : so && e ? K.SIDEWALK_SE
          : n ? K.SIDEWALK_N : so ? K.SIDEWALK_S : w ? K.SIDEWALK_W : e ? K.SIDEWALK_E : K.SIDEWALK,
        x, y,
      );
    }

  function roadTile(x: number, y: number): number {
    const h = isH(x, y), v = isV(x, y);
    if (h && v) return K.ROAD;
    if (h && (isV(x - 1, y) || isV(x + 1, y))) return K.CROSSWALK_H;
    if (v && (isH(x, y - 1) || isH(x, y + 1))) return K.CROSSWALK_V;
    if (h) return y === hRoad(x, y)!.y + 1 ? K.ROAD_DASH_H : K.ROAD;
    return x === vRoad(x, y)!.x ? K.ROAD_DASH_V : K.ROAD;
  }

  // filler on free tiles: trees and bushes on grass, lamps and benches on the sidewalk
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x, h = hash(x, y);
      if (isRoad(x, y) || builtAt(x, y) || m.isRiver(x, y)) continue;
      if (sidewalk.has(k)) {
        if (h % 11 === 0 && !m.isRiver(x, y - 1)) { put(K.LAMP_TOP, x, y - 1); put(K.LAMP_BOTTOM, x, y); }
        else if (h % 17 === 1) put(K.BENCH, x, y);
        else streetProp(fx, streetKind(h), x * T, y * T);
        continue;
      }
      const freeAbove = y > 0 && !isRoad(x, y - 1) && !builtAt(x, y - 1) && !sidewalk.has(k - cols) && !m.isRiver(x, y - 1);
      if (h % 4 === 0 && freeAbove) { put(K.TREE_TOP, x, y - 1); put(K.TREE_BOTTOM, x, y); }
      else if (h % 5 === 1) put(K.BUSH, x, y);
    }

  for (const p of m.plots) DISTRICT_DRAW[p.id](put, fx, p);
  hall(put, fx, m.hall);
  m.hq.forEach((h, n) => {
    if (!h.side) return;
    gable(fx, h as { x: number; y: number; h: number; side: number });
  });
  // a tall house shades the low one next to it: its roof edge below the tall one, its wall foot above it
  m.hq.forEach((h, i) => {
    const n = m.hq[i + 1];
    if (!h.side || !n || n.x !== h.x || h.y + (h.h ?? 0) !== n.y || h.h === n.h) return;
    const lowFirst = (h.h ?? 0) < (n.h ?? 0), low = lowFirst ? h : n, { x, w } = decorBox(low as { x: number; h: number; side: number });
    const y = lowFirst ? (low.y + (low.h ?? 0)) * T - 8 : low.y * T;
    fx.rect(x * T, y, w * T, 8).fill({ color: 0x000000, alpha: 0.14 }).rect(x * T, lowFirst ? y + 4 : y, w * T, 4).fill({ color: 0x000000, alpha: 0.14 });
  });
  root.addChild(fx);
  return root;
}

export type StreetKind = "hydrant" | "bin" | "mailbox" | "bollard" | null;
/** Which small sidewalk prop (if any) a free sidewalk tile gets, from its hash. */
export const streetKind = (h: number): StreetKind => (h % 13 === 2 ? "hydrant" : h % 9 === 4 ? "bin" : h % 23 === 5 ? "mailbox" : h % 7 === 3 ? "bollard" : null);

function streetProp(g: Graphics, kind: StreetKind, px: number, py: number): void {
  if (kind === "hydrant") g.rect(px + 6, py + 7, 4, 6).fill(0xd23a2a).rect(px + 5, py + 9, 6, 2).fill(0xd23a2a).rect(px + 6, py + 6, 4, 1).fill(0x8a2418);
  else if (kind === "bin") g.rect(px + 5, py + 6, 6, 8).fill(0x4a5a52).rect(px + 4, py + 5, 8, 2).fill(0x2f3a36).rect(px + 6, py + 8, 4, 1).fill(0x6a7a72);
  else if (kind === "mailbox") g.rect(px + 7, py + 9, 2, 5).fill(0x3a3a44).rect(px + 4, py + 4, 8, 6).fill(0x2f5fb0).rect(px + 4, py + 4, 8, 1).fill(0x5f8fe0).rect(px + 6, py + 7, 4, 1).fill(0x1a2f60);
  else if (kind === "bollard") g.rect(px + 7, py + 8, 3, 5).fill(0x8a8a92).rect(px + 7, py + 8, 3, 1).fill(0xf0c020);
}

const TILES = [0xb5483a, 0xd9863a, 0xd4b13c, 0x5f9a4c, 0x4a7ab0, 0x5a58a8, 0x8a5aa0]; // red to violet; each house also gets a light or dark shade
const PLASTER = 0xf0e4c8; // one roof, one wall: the heights make the skyline
const mix = (c: number, k: number) => { const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))); return (f(c >> 16) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255); };

/** A tall house (5+ rows) is three tiles wide, reaching one tile outward past the avenue-side column; a low one stays two wide, so the row steps in and out. */
export const decorBox = (b: { x: number; h: number; side: number }) => (b.h >= 5 ? { x: b.side > 0 ? b.x - 1 : b.x, w: 3 } : { x: b.x, w: 2 });

/** A tile-roofed house seen from above: a ridge down the middle, two slopes of tile courses, one floor of wall with a window along the bottom (two floors when tall) and a triangular dormer when tall. The door is on the avenue side of that wall row. */
function gable(g: Graphics, b: { x: number; y: number; h: number; side: number }): void {
  const box = decorBox(b), px = box.x * T, py = b.y * T, w = box.w * T, floors = b.h >= 5 ? 2 : 1, roofH = (b.h - floors) * T, wy = py + roofH;
  const n = b.y * 3 + (b.side > 0 ? 0 : 2), tile = mix(TILES[n % 7]!, [1, 0.8, 1.12][n % 3]!), wall = PLASTER, mid = px + w / 2;
  g.rect(px, py, w / 2, roofH).fill(mix(tile, 1.12)).rect(mid, py, w / 2, roofH).fill(mix(tile, 0.82)); // lit and shaded slope
  for (let y = 3; y < roofH; y += 4) {
    g.rect(px, py + y, w, 1).fill({ color: 0x000000, alpha: 0.2 }); // tile course
    for (let x = ((y >> 2) & 1) * 2 + 3; x < w; x += 4) if (Math.abs(px + x - mid) > 1) g.rect(px + x, py + y - 3, 1, 3).fill({ color: 0x000000, alpha: 0.12 }); // staggered joints
  }
  g.rect(mid - 1, py, 2, roofH).fill(mix(tile, 1.2)).rect(px, py, w, 2).fill(mix(tile, 1.2)); // ridge, and the cap along the far end
  g.rect(px, wy - 3, w, 3).fill({ color: 0x000000, alpha: 0.3 }); // eave shadow on the wall
  for (let f = 0; f < floors; f++) {
    const fy = wy + f * T;
    g.rect(px, fy, w, T).fill(wall).rect(px, fy + T - 2, w, 2).fill({ color: 0x000000, alpha: 0.15 });
    g.rect(b.side > 0 ? px + 8 : px + w - 15, fy + 4, 7, 7).fill(0x5a4a3a).rect(b.side > 0 ? px + 9 : px + w - 14, fy + 5, 5, 5).fill(0xbfe0f0); // window, away from the door
  }
  if (b.h >= 5) {
    const dy = py + Math.floor(roofH / 2 / T) * T; // a dormer: a little wall with a window under its own triangle
    g.rect(mid - 5, dy + 6, 10, 8).fill(wall).rect(mid - 3, dy + 8, 6, 5).fill(0xbfe0f0);
    g.poly([mid - 7, dy + 6, mid + 7, dy + 6, mid, dy - 2]).fill(mix(tile, 1.25)).poly([mid, dy - 2, mid + 7, dy + 6, mid, dy + 6]).fill(mix(tile, 0.9));
  }
  g.rect(b.side > 0 ? px + w - 3 : px, wy + (floors - 1) * T + 3, 3, 13).fill(0x4a2e1a);
}

function parkCar(put: Put, car: number[], x: number, y: number) {
  for (let i = 0; i < 6; i++) put(car[i], x + (i % 3), y + Math.floor(i / 3));
}

interface Box { x: number; y: number; w: number; h: number; up: boolean }
interface HouseOpts {
  door?: number[]; // [top, bottom]
  win?: number | number[]; // window per facade column; [top, bottom] for 2-tall windows
  winEvery?: number; // window on every n-th column (default 2)
  roofRows?: number;
  g?: Graphics; // when given, the roof gets an eave shadow, texture lines and the door an awning
  roofStyle?: "shingle" | "ribbed"; // default shingle lines; ribbed = corrugated tin
  awning?: number; // colour of the striped awning over the door
}
const AWNING = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910];

// the HQ and decor houses: a few looks, picked by position so neighbours rarely match
const HOUSES: { roof: K.Roof; wall: K.Wall; door: number[]; awning: number; prop: "chimney" | "skylight" | "aircon" | "solar"; ribbed?: boolean }[] = [
  { roof: K.ROOF_RED, wall: K.WALL_BRICK, door: K.DOOR_WOOD, awning: AWNING[0]!, prop: "chimney" },
  { roof: K.ROOF_SAND, wall: K.WALL_SAND, door: K.DOOR_GLASS, awning: AWNING[3]!, prop: "skylight" },
  { roof: K.ROOF_DARK, wall: K.WALL_GRAY, door: K.DOOR_GRAY, awning: AWNING[1]!, prop: "aircon", ribbed: true },
  { roof: K.ROOF_LIGHT, wall: K.WALL_WHITE, door: K.DOOR_GLASS, awning: AWNING[2]!, prop: "solar" },
  { roof: K.ROOF_RED, wall: K.WALL_SAND, door: K.DOOR_WOOD, awning: AWNING[2]!, prop: "skylight" },
  { roof: K.ROOF_DARK, wall: K.WALL_BRICK, door: K.DOOR_GRAY, awning: AWNING[3]!, prop: "chimney", ribbed: true },
  { roof: K.ROOF_LIGHT, wall: K.WALL_GLASS, door: K.DOOR_GLASS, awning: AWNING[0]!, prop: "solar" },
  { roof: K.ROOF_SAND, wall: K.WALL_BRICK, door: K.DOOR_WOOD, awning: AWNING[1]!, prop: "aircon" },
];

const HQ_LOOK = HOUSES[6]!;

// rooftop props, all plain rectangles so they sit on any roof colour
function chimney(g: Graphics, x: number, y: number) {
  g.rect(x, y, 7, 10).fill(0x5a4a3a).rect(x - 1, y, 9, 2).fill(0x3a2e24);
}
function skylight(g: Graphics, x: number, y: number, w: number, h: number) {
  g.rect(x, y, w, h).fill(0x9ec9e8).stroke({ color: 0x55606c, width: 1 });
  g.rect(x + (w >> 1), y, 1, h).fill(0x55606c);
}
function aircon(g: Graphics, x: number, y: number) {
  g.rect(x, y, 11, 8).fill(0xc4c8d0).stroke({ color: 0x6a707c, width: 1 });
  g.circle(x + 5.5, y + 4, 2.5).fill(0x6a707c);
}
function solar(g: Graphics, x: number, y: number, w: number, h: number) {
  g.rect(x, y, w, h).fill(0x23406e).stroke({ color: 0xaab4c4, width: 1 });
  for (let i = 4; i < w; i += 4) g.rect(x + i, y, 1, h).fill({ color: 0xaab4c4, alpha: 0.6 });
  for (let j = 4; j < h; j += 4) g.rect(x, y + j, w, 1).fill({ color: 0xaab4c4, alpha: 0.6 });
}

/** The HQ: one white hall, a wing either side of the gateway street, joined by a roof bridge with a dome. Every room has its own door. */
function hall(put: Put, g: Graphics, b: { x: number; y: number; w: number; h: number }) {
  house(put, { ...b, up: false }, K.ROOF_LIGHT, K.WALL_WHITE, { g });
  const fy = (b.y + b.h - 2) * T; // facade: upper row = windows, lower row = doors
  for (let i = 1; i <= 10; i++) {
    const x = (b.x + i) * T;
    g.rect(x + 4, fy + 3, 8, 7).fill(0xbfe0f0).stroke({ color: 0x8a8e98, width: 1 }); // room window
    g.rect(x + 4, fy + T + 4, 8, 12).fill(0x4a2e1a).rect(x + 3, fy + T + 2, 10, 3).fill(0xc0392b); // room door and awning
  }
  const cx = (b.x + b.w / 2) * T, by = b.y * T;
  g.rect(cx - 3 * T, by + 2, 6 * T, 2 * T - 4).fill(0xeeeef4).stroke({ color: 0x8a8e98, width: 1 }); // portico
  for (let k = -2; k <= 2; k++) g.rect(cx + k * T * 1.2 - 1, by + 2 * T - 2, 3, 2).fill(0xf4f4f8);
  g.circle(cx, by + 4, 14).fill(0xf0f0f4).stroke({ color: 0x8a8e98, width: 1 }); // dome
  g.rect(cx - 1, by - 14, 1, 14).fill(0x555555).rect(cx, by - 14, 7, 4).fill(0xc0392b); // flag
}

/**
 * A building: 9-slice roof plus a 2-row facade on the road side.
 * Up-facing plots mirror the order (facade on top) so the door always meets the road.
 */
function house(put: Put, b: Box, roof: K.Roof, wall: K.Wall, o: HouseOpts = {}) {
  const roofRows = o.roofRows ?? b.h - 2;
  const fr = b.h - roofRows; // facade rows
  const ry = b.up ? b.y + fr : b.y;
  const fy = b.up ? b.y : b.y + roofRows;
  for (let j = 0; j < roofRows; j++)
    for (let i = 0; i < b.w; i++) {
      const top = j === 0, bot = j === roofRows - 1, l = i === 0, r = i === b.w - 1;
      put(top ? (l ? roof.tl : r ? roof.tr : roof.t) : bot ? (l ? roof.bl : r ? roof.br : roof.b) : l ? roof.l : r ? roof.r : roof.c, b.x + i, ry + j);
    }
  // facade rows, upper floor first (down plots) / ground floor first (up plots)
  const door = b.x + (b.w >> 1);
  for (let j = 0; j < fr; j++) {
    const ground = b.up ? j === 0 : j === fr - 1;
    const row = ground ? wall.base : wall.top;
    for (let i = 0; i < b.w; i++) {
      const x = b.x + i;
      put(i === 0 ? row[0] : i === b.w - 1 ? row[2] : row[1], x, fy + j);
      if (x === door || !o.win || i === 0 || i === b.w - 1 || i % (o.winEvery ?? 2) !== 1 % (o.winEvery ?? 2)) continue;
      // 2-tall windows/doors read top-to-bottom in either facade order
      put(Array.isArray(o.win) ? o.win[j] : o.win, x, fy + j);
    }
  }
  // the door's bottom meets the ground-floor row on the road side
  const dy = b.up ? fy : fy + fr - (o.door?.length ?? 0);
  o.door?.forEach((t, k) => put(t, door, dy + k));
  const g = o.g;
  if (g) {
    const x0 = b.x * T, w = b.w * T, y0 = ry * T, h = roofRows * T;
    for (let y = y0 + 6; y < y0 + h - 5; y += 4)
      if (o.roofStyle === "ribbed") for (let x = x0 + 3; x < x0 + w - 3; x += 4) g.rect(x, y0 + 3, 1, h - 7).fill({ color: 0x000000, alpha: 0.12 });
      else g.rect(x0 + 2, y, w - 4, 1).fill({ color: 0x000000, alpha: 0.1 });
    g.rect(x0, b.up ? y0 : y0 + h - 4, w, 4).fill({ color: 0x000000, alpha: 0.22 }); // eave shadow over the facade
    g.rect(x0, b.up ? y0 + h - 1 : y0, w, 1).fill({ color: 0xffffff, alpha: 0.3 }); // lit far edge
    if (o.awning !== undefined && o.door && !b.up) {
      const ax = door * T - 3, ay = dy * T - 1;
      for (let i = 0; i < 5; i++) g.rect(ax + i * 4, ay, 4, 5).fill(i % 2 ? 0xf4f0e6 : o.awning);
      g.rect(ax, ay + 5, 20, 1).fill({ color: 0x000000, alpha: 0.3 });
    }
  }
  return { ry, fy, roofRows };
}

const fill = (put: Put, i: number, x: number, y: number, w: number, h: number) => {
  for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) put(i, x + k, y + j);
};

type DrawFn = (put: Put, g: Graphics, p: Box) => void;

const DISTRICT_DRAW: Record<District, DrawFn> = {
  library: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_RED, K.WALL_BRICK, { door: K.DOOR_GLASS, win: K.WIN_ARCH, g, awning: AWNING[1] });
    chimney(g, (p.x + p.w - 2) * T, ry * T + 6);
    skylight(g, (p.x + 2) * T, ry * T + 12, 22, 14);
    skylight(g, (p.x + 5) * T, ry * T + 12, 22, 14);
  },
  design: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_LIGHT, K.WALL_GLASS, { door: K.DOOR_GLASS, g, awning: AWNING[0] });
    solar(g, (p.x + 1) * T + 2, ry * T + 8, 46, 20);
    solar(g, (p.x + 5) * T - 2, ry * T + 8, 46, 20);
  },
  review: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_DARK, K.WALL_GRAY, { door: K.DOOR_GLASS, win: K.WIN_GRAY, winEvery: 1, g, awning: AWNING[3] });
    aircon(g, (p.x + 1) * T + 2, ry * T + 8);
    aircon(g, (p.x + 3) * T, ry * T + 8);
    aircon(g, (p.x + p.w - 3) * T, ry * T + 8);
    chimney(g, (p.x + p.w - 2) * T, ry * T + 6);
  },
  lab: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_LIGHT, K.WALL_WHITE, { door: K.DOOR_GLASS, g, awning: AWNING[2] });
    aircon(g, p.x * T + 5, ry * T + 8);
    solar(g, (p.x + 2) * T, ry * T + 4, 26, 12);
    g.circle((p.x + 3) * T + 4, ry * T + 23, 4).fill(0xe8eaf0).stroke({ color: 0x6a707c, width: 1 }); // satellite dish
  },
  townhall: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_LIGHT, K.WALL_SAND, { door: K.DOOR_GRAY, win: K.WIN_ARCH, g, awning: AWNING[0] });
    const cx = (p.x + (p.w >> 1)) * T;
    g.circle(cx, ry * T + 38, 6).fill(0xf8f4e8).stroke({ color: 0x5a4a3a, width: 1 }); // clock over the entrance
    g.rect(cx, ry * T + 34, 1, 4).fill(0x3a3a3a).rect(cx, ry * T + 38, 3, 1).fill(0x3a3a3a);
    chimney(g, (p.x + 1) * T, ry * T + 10);
    chimney(g, (p.x + p.w - 2) * T, ry * T + 10);
    // flagpole and flag on the roof
    g.rect(cx - 1, ry * T + 2, 2, 18).fill(0x3a3a3a);
    g.rect(cx + 1, ry * T + 2, 10, 6).fill(0xd94a3a);
  },
  database: (put, g, p) => {
    // warehouse: tin roof, roller shutters, barrels and crates out front
    house(put, { ...p, w: p.w - 1 }, K.ROOF_DARK, K.WALL_GRAY, { door: K.SHUTTER, win: K.SHUTTER, winEvery: 3, g, roofStyle: "ribbed" });
    const x = p.x + p.w - 1;
    for (let j = 0; j < p.h; j++) put(j % 2 ? K.BARREL : K.CRATE, x, p.y + j);
  },
  factory: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_SAND, K.WALL_BRICK, { door: K.SHUTTER, win: K.WIN_BROWN, winEvery: 2, g, roofStyle: "ribbed" });
    // sawtooth roof (shaded teeth) and two chimneys with smoke
    for (let i = 0; i + 2 <= p.w; i += 2) {
      const x0 = (p.x + i) * T + 2, x1 = (p.x + i + 2) * T - 2, top = ry * T + 4, bot = (ry + 3) * T - 4;
      g.poly([x0, bot, x1, top, x1, bot]).fill({ color: 0x6b5a40, alpha: 0.35 });
      g.moveTo(x0, bot).lineTo(x1, top).stroke({ color: 0xf0e0b8, width: 1 });
    }
    for (const cx of [p.x + 1, p.x + p.w - 2]) {
      g.rect(cx * T + 4, ry * T - 6, 8, 14).fill(0x5a4a3a);
      g.circle(cx * T + 9, ry * T - 9, 3).fill({ color: 0xdddddd, alpha: 0.7 });
    }
  },
  airport: (put, g, p) => {
    // apron with a taxi line, a small terminal, a parked plane and a car park
    fill(put, K.ROAD, p.x, p.y, p.w, p.h);
    for (let i = p.x + 3; i < p.x + p.w; i++) put(K.ROAD_DASH_H, i, p.y + 2);
    put(K.PARKING, p.x + p.w - 1, p.y + p.h - 1);
    parkCar(put, K.CARS[0], p.x + 5, p.y + 3);
    const t = house(put, { x: p.x, y: p.y, w: 3, h: p.h, up: p.up }, K.ROOF_LIGHT, K.WALL_GLASS, { roofRows: 3, g });
    aircon(g, p.x * T + 6, t.ry * T + 8);
    aircon(g, p.x * T + 28, t.ry * T + 8);
    skylight(g, p.x * T + 8, t.ry * T + 26, 30, 10);
    const px = (p.x + 4) * T, py = (p.y + 1) * T + 14; // plane nose-left on the taxi line
    g.rect(px + 18, py - 16, 8, 32).fill(0xc8ccd4); // wings
    g.rect(px + 38, py - 7, 5, 14).fill(0xc8ccd4); // tail
    g.roundRect(px, py - 3, 46, 6, 3).fill(0xf4f4f8).stroke({ color: 0x5a6070, width: 1 });
  },
  watchtower: (put, g, p) => {
    // a lookout in a small park, drawn like its neighbours (roof from above, two facade rows): a parapet with battlements, a radar dish, a searchlight and a mast.
    // The top row stays the sidewalk along the main road, so the lot and the tower start one row lower.
    fill(put, K.GRASS[0], p.x, p.y + 1, p.w, p.h - 1);
    for (const x of [p.x + 1, p.x + p.w - 2]) put(K.BUSH, x, p.y + 3);
    const tx = p.x + (p.w >> 1) - 1, x0 = tx * T, y0 = (p.y + 1) * T, w = 3 * T;
    house(put, { x: tx, y: p.y + 1, w: 3, h: p.h - 1, up: p.up }, K.ROOF_DARK, K.WALL_GRAY, { door: K.DOOR_GRAY, win: K.WIN_GRAY, winEvery: 1, roofRows: 2, g });
    g.rect(x0, y0, w, 2 * T - 4).stroke({ color: 0x6a6e64, width: 2 }); // parapet
    for (let x = x0 + 2; x < x0 + w - 4; x += 8) g.rect(x, y0 - 2, 5, 3).fill(0x6a6e64); // battlements along the far edge
    g.circle(x0 + 14, y0 + 16, 6).fill(0xe8eaf0).stroke({ color: 0x6a707c, width: 1 }).rect(x0 + 14, y0 + 10, 1, 6).fill(0x6a707c); // radar dish and sweep arm
    g.circle(x0 + 7, y0 + 7, 3).fill(0xffe28a).stroke({ color: 0x6a6e64, width: 1 }); // searchlight
    g.rect(x0 + 32, y0 + 16, 6, 6).fill(0x4a5048); // mast base
    g.rect(x0 + 34, y0 + 3, 2, 15).fill(0x3a3a3a).rect(x0 + 30, y0 + 8, 10, 1).fill(0x3a3a3a).circle(x0 + 35, y0 + 2, 2).fill(0xe04040); // mast, crossbar, beacon
  },
  home: (put, g, p) => {
    // two small tiled-roof houses with a yard between
    fill(put, K.GRASS[1], p.x, p.y, p.w, p.h);
    const hy = p.up ? p.y : p.y + 1;
    const a = house(put, { x: p.x, y: hy, w: 4, h: p.h - 1, up: p.up }, K.ROOF_RED, K.WALL_SAND, { door: K.DOOR_WOOD, win: K.WIN_BROWN, g, awning: AWNING[3] });
    const b = house(put, { x: p.x + 5, y: hy, w: 4, h: p.h - 1, up: p.up }, K.ROOF_SAND, K.WALL_BRICK, { door: K.DOOR_WOOD, win: K.WIN_BROWN, g, awning: AWNING[2] });
    chimney(g, (p.x + 3) * T - 4, a.ry * T + 4);
    chimney(g, (p.x + 5) * T + 4, b.ry * T + 4);
    put(K.BUSH, p.x + 4, p.y + 2);
    put(K.SIDEWALK, p.x + 4, p.up ? p.y : p.y + p.h - 1); // path to the district door on the road
  },
  site: (put, g, p) => {
    // dirt lot, a concrete frame going up under scaffolding, tower crane, mixer, brick pile, cones, yellow-black fence on the road side
    fill(put, K.DIRT, p.x, p.y, p.w, p.h);
    const fy = p.up ? p.y : p.y + p.h - 1, door = p.x + (p.w >> 1);
    for (let i = p.x; i < p.x + p.w; i++) if (i !== door) put(K.BARRIER, i, fy);
    put(K.CONE, door - 1, p.up ? p.y + 1 : p.y + p.h - 2);
    const ox = p.x * T, oy = (p.up ? p.y + 1 : p.y) * T, base = oy + 52;
    // the building: ground slab, four concrete columns with rebar sticking out, a first floor slab, bricks going up on the left
    g.rect(ox + 6, base - 4, 68, 4).fill(0x8a8a92);
    for (let i = 0; i < 4; i++) g.rect(ox + 8 + i * 20, oy + 14, 5, 34).fill(0xb4b4b8).rect(ox + 9 + i * 20, oy + 8, 1, 6).fill(0x8a4a2a).rect(ox + 11 + i * 20, oy + 10, 1, 4).fill(0x8a4a2a);
    g.rect(ox + 6, oy + 14, 46, 4).fill(0x9c9ca4).rect(ox + 6, oy + 18, 46, 1).fill({ color: 0x000000, alpha: 0.3 });
    g.rect(ox + 13, oy + 30, 20, 18).fill(0xb5523b);
    for (let r = 0; r < 4; r++) g.rect(ox + 13, oy + 34 + r * 4, 20, 1).fill(0xe0d0c0);
    for (let r = 0; r < 5; r++) for (let x = ox + 13 + (r % 2) * 5; x < ox + 33; x += 10) g.rect(x, oy + 30 + r * 4, 1, 4).fill(0xe0d0c0);
    // scaffolding over the right half: poles, planks, diagonal braces
    for (let i = 0; i < 3; i++) g.rect(ox + 38 + i * 16, oy + 12, 2, 38).fill(0x9a9aa2);
    for (const y of [oy + 26, oy + 38]) g.rect(ox + 36, y, 36, 2).fill(0xc8963c);
    g.moveTo(ox + 39, oy + 38).lineTo(ox + 55, oy + 26).moveTo(ox + 55, oy + 38).lineTo(ox + 71, oy + 26).stroke({ color: 0x9a9aa2, width: 1 });
    // pile of bricks on a pallet
    g.rect(ox + 80, base - 6, 16, 6).fill(0xb5523b).rect(ox + 80, base - 3, 16, 1).fill(0xe0d0c0).rect(ox + 78, base, 20, 2).fill(0x8a6a3a);
    g.rect(ox + 83, base - 9, 10, 3).fill(0xa84a36);
    // tower crane: lattice mast, jib, counterweight, cab, cable and hook
    const cx = ox + 104;
    g.rect(cx, oy - 14, 4, base - oy + 14).fill(0xf0c020);
    for (let y = oy - 10; y < base - 4; y += 8) g.moveTo(cx, y).lineTo(cx + 4, y + 8).moveTo(cx + 4, y).lineTo(cx, y + 8).stroke({ color: 0x6a5410, width: 1 });
    g.rect(cx - 40, oy - 16, 76, 3).fill(0xf0c020).rect(cx + 24, oy - 14, 12, 6).fill(0x555555).rect(cx - 3, oy - 20, 10, 6).fill(0xdddddd);
    g.rect(cx - 28, oy - 13, 1, 30).fill(0x222222).rect(cx - 30, oy + 17, 5, 3).fill(0xc03030);
    // cement mixer: tilted orange drum on a frame with a wheel
    const mx = ox + 124, my = oy + 40;
    g.rect(mx - 6, my + 4, 2, 8).fill(0x444444).rect(mx + 4, my + 4, 2, 8).fill(0x444444).circle(mx + 8, my + 12, 2).fill(0x222222);
    g.ellipse(mx, my, 8, 6).fill(0xe8892b).stroke({ color: 0x8a4a10, width: 1 }).rect(mx - 5, my - 2, 10, 2).fill(0xf6b060);
  },
};
