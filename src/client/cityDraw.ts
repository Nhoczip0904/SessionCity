import { Container, Graphics, Sprite } from "pixi.js";
import type { District } from "../shared/types.js";
import * as K from "./tiles.js";
import type { Sheets } from "./tiles.js";

const T = 16;

export interface MapLayout {
  cols: number;
  rows: number;
  isRoad(x: number, y: number): boolean;
  isPath(x: number, y: number): boolean;
  roadRows: number[];
  roadCols: number[];
  plots: { id: District; x: number; y: number; w: number; h: number; up: boolean }[];
  hq: { x: number; y: number; up: boolean }[];
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
  const isH = (x: number, y: number) => m.roadRows.includes(y) && isRoad(x, y);
  const isV = (x: number, y: number) => m.roadCols.includes(x) && isRoad(x, y);
  const builtAt = (x: number, y: number) => m.built.has(y * cols + x);

  // ground: roads, sidewalk ring around each block, grass elsewhere
  const sidewalk = new Set<number>();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
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
    if (h) return m.roadRows.includes(y - 1) ? K.ROAD_DASH_H : K.ROAD;
    return m.roadCols.includes(x + 1) ? K.ROAD_DASH_V : K.ROAD;
  }

  // filler on free tiles: trees and bushes on grass, lamps and benches on the sidewalk
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x, h = hash(x, y);
      if (isRoad(x, y) || builtAt(x, y)) continue;
      if (sidewalk.has(k)) {
        if (h % 11 === 0) { put(K.LAMP_TOP, x, y - 1); put(K.LAMP_BOTTOM, x, y); }
        else if (h % 17 === 1) put(K.BENCH, x, y);
        continue;
      }
      const freeAbove = y > 0 && !isRoad(x, y - 1) && !builtAt(x, y - 1) && !sidewalk.has(k - cols);
      if (h % 4 === 0 && freeAbove) { put(K.TREE_TOP, x, y - 1); put(K.TREE_BOTTOM, x, y); }
      else if (h % 5 === 1) put(K.BUSH, x, y);
    }

  for (const p of m.plots) DISTRICT_DRAW[p.id](put, fx, p);
  m.hq.forEach((h) => house(put, { x: h.x, y: h.y, w: 2, h: 4, up: h.up }, K.ROOF_LIGHT, K.WALL_SAND, { door: K.DOOR_GLASS }));
  root.addChild(fx);
  return root;
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
  return { ry, fy, roofRows };
}

const fill = (put: Put, i: number, x: number, y: number, w: number, h: number) => {
  for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) put(i, x + k, y + j);
};

type DrawFn = (put: Put, g: Graphics, p: Box) => void;

const DISTRICT_DRAW: Record<District, DrawFn> = {
  library: (put, _g, p) => house(put, p, K.ROOF_RED, K.WALL_BRICK, { door: K.DOOR_GLASS, win: K.WIN_ARCH }),
  design: (put, _g, p) => house(put, p, K.ROOF_LIGHT, K.WALL_GLASS, { door: K.DOOR_GLASS }),
  review: (put, _g, p) => house(put, p, K.ROOF_DARK, K.WALL_GRAY, { door: K.DOOR_GLASS, win: K.WIN_GRAY, winEvery: 1 }),
  lab: (put, _g, p) => house(put, p, K.ROOF_LIGHT, K.WALL_WHITE, { door: K.DOOR_GLASS }),
  townhall: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_LIGHT, K.WALL_SAND, { door: K.DOOR_DARK, win: K.WIN_ARCH });
    const cx = (p.x + (p.w >> 1)) * T;
    // flagpole and flag on the roof
    g.rect(cx - 1, ry * T + 2, 2, 18).fill(0x3a3a3a);
    g.rect(cx + 1, ry * T + 2, 10, 6).fill(0xd94a3a);
  },
  database: (put, _g, p) => {
    // warehouse: tin roof, roller shutters, barrels and crates out front
    house(put, { ...p, w: p.w - 1 }, K.ROOF_DARK, K.WALL_GRAY, { door: K.SHUTTER, win: K.SHUTTER, winEvery: 3 });
    const x = p.x + p.w - 1;
    for (let j = 0; j < p.h; j++) put(j % 2 ? K.BARREL : K.CRATE, x, p.y + j);
  },
  factory: (put, g, p) => {
    const { ry } = house(put, p, K.ROOF_SAND, K.WALL_BRICK, { door: K.SHUTTER, win: K.WIN_BROWN, winEvery: 2 });
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
    house(put, { x: p.x, y: p.y, w: 3, h: p.h, up: p.up }, K.ROOF_LIGHT, K.WALL_GLASS, { roofRows: 3 });
    const px = (p.x + 4) * T, py = (p.y + 1) * T + 14; // plane nose-left on the taxi line
    g.rect(px + 18, py - 16, 8, 32).fill(0xc8ccd4); // wings
    g.rect(px + 38, py - 7, 5, 14).fill(0xc8ccd4); // tail
    g.roundRect(px, py - 3, 46, 6, 3).fill(0xf4f4f8).stroke({ color: 0x5a6070, width: 1 });
  },
  watchtower: (put, g, p) => {
    // tall narrow tower centred in a small park
    fill(put, K.GRASS[0], p.x, p.y, p.w, p.h);
    const tx = p.x + (p.w >> 1) - 1;
    house(put, { x: tx, y: p.y, w: 3, h: p.h, up: p.up }, K.ROOF_LIGHT, K.WALL_GRAY, { door: K.DOOR_DARK, win: K.WIN_GRAY, winEvery: 1, roofRows: 2 });
    for (const x of [p.x + 1, p.x + p.w - 2]) put(K.BUSH, x, p.y + 2);
    const ax = (tx + 3) * T - 4, ay = (p.up ? p.y + 3 : p.y) * T + 4; // antenna on the roof corner
    g.rect(ax - 1, ay - 14, 2, 18).fill(0x3a3a3a);
    g.rect(ax - 4, ay - 10, 8, 1).fill(0x3a3a3a);
    g.circle(ax, ay - 15, 2).fill(0xe04040);
  },
  home: (put, _g, p) => {
    // two small tiled-roof houses with a yard between
    fill(put, K.GRASS[1], p.x, p.y, p.w, p.h);
    const hy = p.up ? p.y : p.y + 1;
    house(put, { x: p.x, y: hy, w: 4, h: p.h - 1, up: p.up }, K.ROOF_RED, K.WALL_SAND, { door: K.DOOR_WOOD, win: K.WIN_BROWN });
    house(put, { x: p.x + 5, y: hy, w: 4, h: p.h - 1, up: p.up }, K.ROOF_RED, K.WALL_BRICK, { door: K.DOOR_WOOD, win: K.WIN_BROWN });
    put(K.BUSH, p.x + 4, p.y + 2);
    put(K.SIDEWALK, p.x + 4, p.up ? p.y : p.y + p.h - 1); // path to the district door on the road
  },
  site: (put, g, p) => {
    // dirt lot, half-built frame, crates, cones, yellow-black fence on the road side
    fill(put, K.DIRT, p.x, p.y, p.w, p.h);
    const fy = p.up ? p.y : p.y + p.h - 1, door = p.x + (p.w >> 1);
    for (let i = p.x; i < p.x + p.w; i++) if (i !== door) put(K.BARRIER, i, fy);
    put(K.CONE, door - 1, p.up ? p.y + 1 : p.y + p.h - 2);
    put(K.CRATE, p.x, p.up ? p.y + 4 : p.y); put(K.CRATE, p.x + 1, p.up ? p.y + 4 : p.y);
    put(K.CRATE, p.x + p.w - 1, p.up ? p.y + 4 : p.y);
    const sx = (p.x + 2) * T, sy = (p.up ? p.y + 1 : p.y) * T + 4, sw = (p.w - 4) * T, sh = 3 * T - 8;
    for (let i = 0; i <= 4; i++) g.rect(sx + Math.round((i * (sw - 2)) / 4), sy, 2, sh).fill(0x9a9aa2);
    for (let j = 0; j <= 2; j++) g.rect(sx, sy + Math.round((j * (sh - 2)) / 2), sw, 2).fill(0x9a9aa2);
    g.rect(sx + sw - 8, sy - 10, 3, sh + 10).fill(0xf0c020); // crane mast
    g.rect(sx + sw - 34, sy - 10, 34, 3).fill(0xf0c020);
  },
};
