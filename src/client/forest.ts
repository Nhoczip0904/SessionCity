import { Container, Graphics, Sprite, Ticker } from "pixi.js";
import * as K from "./tiles.js";
import type { Sheets } from "./tiles.js";
import { onRoad, type Road } from "./roads.js";
import type { Pt } from "./path.js";

const T = 16;
/** Tiles of forest around the city: enough to fill a wide window. */
export const FOREST = 24;

/** West of the city: a railway runs north-south at column RAIL_X with a station on its east side. */
export const RAIL_X = -11;
export const STATION = { x: -6, y: 19, w: 5, h: 4 }; // the building; its platform is the column beside the track
const inStation = (x: number, y: number) => x >= RAIL_X - 1 && x <= STATION.x + STATION.w && y >= STATION.y - 4 && y <= STATION.y + STATION.h + 4;
/** Decorative resort where forest meets beach, east of the city (tiles; x counts from the city's east edge). Trees and bushes make room; roads and the sea stay clear. */
export const RESORT = { dx: 1, y: 19, w: 9, h: 15 };
const inResort = (x: number, y: number, cols: number) => x >= cols + RESORT.dx && x < cols + RESORT.dx + RESORT.w && y >= RESORT.y && y < RESORT.y + RESORT.h;
export type BeachProp = "palm" | "umbrella" | "towel" | "ball" | null;
/** East of the city: sand from this many columns past the city's edge, the sea a few columns after it. */
export const SAND_FROM = 3, SEA_FROM = 9;
/** The shore is not straight: the sand starts up to 2 columns earlier and the sea up to 3 later, by row. */
export const sandFrom = (y: number) => SAND_FROM - Math.round(1 + Math.sin(y / 3.1 + 2));
export const seaFrom = (y: number) => SEA_FROM + Math.round(1.5 + 1.5 * Math.sin(y / 4.7) * Math.cos(y / 11));

const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;

export interface ForestPlan {
  /** every tile of the square: grass, a road tile (road: true), or the sidewalk beside a road (walk: true); under the city it is plain grass, so no gap shows at the map's edge */
  ground: { x: number; y: number; tile: number; road: boolean; walk: boolean }[];
  /** trees stand on `y` with the crown on the tile above; the list is in drawing order (top to bottom) */
  trees: (Pt & { shade: number })[];
  bushes: Pt[];
  /** the river carried on through the forest; banks are the sides where the water ends */
  water: (Pt & { deep: boolean; bankL: boolean; bankR: boolean })[];
  /** the beach east of the city; the sea stops short of road tiles, so a road runs on as a causeway */
  sand: (Pt & { wet: boolean; prop: BeachProp })[];
  sea: (Pt & { depth: number })[]; // columns out from the shore
}

/**
 * What the forest holds: the tiles of the square [-FOREST, cols+FOREST) × [-FOREST, rows+FOREST). The city itself
 * (columns 0..cols-1, rows 0..cityRows-1) gets only grass: the map drawn above covers it. Roads leaving the city carry
 * a sidewalk on both sides; trees keep clear of them.
 */
export function planForest(cols: number, rows: number, cityRows: number, roads: Road[], riverLeft: (y: number) => number): ForestPlan {
  const wet = (x: number, y: number) => x >= riverLeft(y) && x < riverLeft(y) + 3;
  const inside = (x: number, y: number) => x >= 0 && x < cols && y >= 0 && y < cityRows;
  // the main road ends two tiles into the sand: it does not run on into the sea
  const road = (x: number, y: number) => (x >= cols + sandFrom(y) + 2 ? undefined : roads.find((r) => onRoad(r, x, y)));
  const nearRoad = (x: number, y: number) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (road(x + i, y + j)) return true;
    return false;
  };
  const nearWater = (x: number, y: number) => wet(x - 1, y) || wet(x + 1, y);
  const plan: ForestPlan = { ground: [], trees: [], bushes: [], water: [], sand: [], sea: [] };
  for (let y = -FOREST; y < rows + FOREST; y++)
    for (let x = -FOREST; x < cols + FOREST; x++) {
      const r = road(x, y);
      const h = hash(x, y);
      if (inside(x, y)) {
        plan.ground.push({ x, y, tile: K.GRASS[h % K.GRASS.length]!, road: false, walk: false });
        continue;
      }
      if (wet(x, y) && !r) {
        plan.water.push({ x, y, deep: x === riverLeft(y) + 1, bankL: !wet(x - 1, y), bankR: !wet(x + 1, y) });
        continue;
      }
      if (r) {
        const dash = r.w > r.h ? y === r.y + 1 : x === r.x; // the same dashes as the roads inside the city
        plan.ground.push({ x, y, tile: r.w > r.h ? (dash ? K.ROAD_DASH_H : K.ROAD) : dash ? K.ROAD_DASH_V : K.ROAD, road: true, walk: false });
        continue;
      }
      if (nearRoad(x, y)) {
        // the same edge pieces as the city's own sidewalks, named by the side the road is on
        const n = !!road(x, y - 1), so = !!road(x, y + 1), w = !!road(x - 1, y), e = !!road(x + 1, y);
        const tile = n && w ? K.SIDEWALK_NW : n && e ? K.SIDEWALK_NE : so && w ? K.SIDEWALK_SW : so && e ? K.SIDEWALK_SE
          : n ? K.SIDEWALK_N : so ? K.SIDEWALK_S : w ? K.SIDEWALK_W : e ? K.SIDEWALK_E : K.SIDEWALK;
        plan.ground.push({ x, y, tile, road: false, walk: true });
        if (x >= cols + sandFrom(y) && x < cols + seaFrom(y)) plan.sand.push({ x, y, wet: false, prop: null });
        continue;
      }
      plan.ground.push({ x, y, tile: K.GRASS[h % K.GRASS.length]!, road: false, walk: false });
      if (x >= cols + sandFrom(y)) {
        const sea = cols + seaFrom(y);
        if (x >= sea) plan.sea.push({ x, y, depth: x - sea });
        else {
          // props are few and far apart: palms at the back, the odd parasol, towel or ball toward the water
          const col = x - cols - sandFrom(y);
          const pick: BeachProp = col <= 1 ? (h % 11 === 0 ? "palm" : null) : h % 19 === 0 ? "umbrella" : h % 43 === 1 ? "towel" : h % 61 === 2 ? "ball" : null;
          const prop = pick && !inResort(x, y, cols) && !plan.sand.some((o) => o.prop && Math.abs(o.x - x) < 4 && Math.abs(o.y - y) < 4) ? pick : null;
          plan.sand.push({ x, y, wet: x === sea - 1, prop });
        }
        continue;
      }
      if (x === RAIL_X || inStation(x, y) || nearWater(x, y) || (y >= -1 && y <= cityRows && (x === -1 || x === cols)) || inResort(x, y, cols) || inResort(x, y - 1, cols)) continue; // the track runs the whole height
      if (h % 3 !== 0 && !inside(x, y - 1)) plan.trees.push({ x, y, shade: h % 7 });
      else if (h % 5 === 1) plan.bushes.push({ x, y });
    }
  return plan;
}

const SEA = [0x62cfdc, 0x4fb8dc, 0x3a9ad4, 0x2f86c8, 0x2a78b8, 0x2468a8];
function drawBeach(plan: ForestPlan): Graphics {
  const g = new Graphics();
  for (const t of plan.sand) {
    const px = t.x * T, py = t.y * T, h = hash(t.x, t.y);
    g.rect(px, py, T, T).fill(t.wet ? 0xd2b97e : h % 5 ? 0xeedbaa : 0xe4d098);
    if (!t.wet && h % 3 === 0) g.rect(px + (h % 11), py + ((h >> 2) % 13), 2, 1).fill(0xd2bc86);
  }
  for (const t of plan.sea) {
    const px = t.x * T, py = t.y * T, h = hash(t.x, t.y);
    g.rect(px, py, T, T).fill(SEA[Math.min(t.depth, SEA.length - 1)]!);
    if (h % 4 === 0) g.rect(px + (h % 7), py + 4 + ((h >> 3) % 8), 5, 1).fill({ color: 0xffffff, alpha: 0.4 });
    if (t.depth === 0) { // surf: foam breaking along the shore, wavy by row
      const o = Math.round(Math.sin(t.y * 1.3) * 2);
      g.rect(px + o, py, 3, T).fill({ color: 0xffffff, alpha: 0.85 }).rect(px + 3 + o, py + 2, 1, 5).fill({ color: 0xffffff, alpha: 0.6 }).rect(px + 3 + o, py + 10, 1, 4).fill({ color: 0xffffff, alpha: 0.6 });
    }
  }
  for (const t of plan.sand) {
    if (!t.prop) continue;
    const h = hash(t.x, t.y), px = t.x * T + (h % 7) - 3, py = t.y * T + ((h >> 3) % 7) - 3, col = [0xe0483a, 0x3a8fe0, 0xf0c020, 0x3ab08a][h % 4]!;
    if (t.prop === "umbrella") {
      g.rect(px + 1, py + 9, 4, 6).fill(0xf4f4f8).rect(px + 1, py + 9, 4, 1).fill(0x3a8fe0).rect(px + 1, py + 12, 4, 1).fill(0x3a8fe0); // lounger beside it
      g.circle(px + 11, py + 8, 6).fill({ color: 0x000000, alpha: 0.18 }).circle(px + 10, py + 7, 6).fill(col);
      for (let a = 0; a < 6; a += 2) g.moveTo(px + 10, py + 7).lineTo(px + 10 + Math.cos(a * 1.05) * 6, py + 7 + Math.sin(a * 1.05) * 6).stroke({ color: 0xffffff, width: 1.5 });
      g.circle(px + 10, py + 7, 1).fill(0x5a3a22);
    } else if (t.prop === "towel") g.rect(px + 3, py + 3, 6, 10).fill(col).rect(px + 3, py + 6, 6, 1).fill(0xffffff).rect(px + 3, py + 9, 6, 1).fill(0xffffff);
    else if (t.prop === "ball") g.circle(px + 8, py + 9, 3).fill(0xf4f4f8).rect(px + 6, py + 8, 4, 1).fill(0xe0483a).rect(px + 7, py + 7, 2, 4).fill(0x3a8fe0);
    else { // palm: leaning trunk, crown of fronds
      g.rect(px + 7, py - 2, 2, 15).fill(0x7a5a3a).rect(px + 7, py + 2, 2, 1).fill(0x5a3a22).rect(px + 7, py + 7, 2, 1).fill(0x5a3a22);
      for (const [dx, dy, w, hh] of [[-7, -8, 9, 3], [-1, -10, 9, 3], [-8, -5, 8, 3], [0, -6, 8, 3], [-4, -12, 8, 3]] as const) g.ellipse(px + 8 + dx + w / 2, py + dy + hh, w / 2 + 1, hh / 2 + 1).fill(h % 2 ? 0x2f8a3a : 0x3a9a45);
      g.circle(px + 7, py - 4, 1.2).fill(0x6a4a22).circle(px + 10, py - 4, 1.2).fill(0x6a4a22); // coconuts
    }
  }
  return g;
}

/** A resort for show: one long hotel with a tiled roof, pool with loungers and parasols, a pier out to sea. */
function drawResort(cols: number): Graphics {
  const g = new Graphics();
  const ox = (cols + RESORT.dx) * T, oy = RESORT.y * T, W = RESORT.w * T, H = RESORT.h * T;
  const R = (x: number, y: number, w: number, h: number, c: number) => g.rect(ox + x, oy + y, w, h).fill(c);
  R(0, 0, W, H, 0xe6d3a0); // paved forecourt
  // hotel: tiled roof seen from above, a wall face with windows toward the sea
  R(4, 6, 64, H - 12, 0xc8553a); R(4, 6, 64, 3, 0xe0704e); R(34, 6, 3, H - 12, 0xa4412c);
  for (let y = 12; y < H - 8; y += 6) R(4, y, 64, 1, 0xb04a32);
  R(68, 6, 12, H - 12, 0xf4ead0); R(80, 6, 1, H - 12, 0xc8b88a);
  for (let y = 14; y < H - 20; y += 14) { R(71, y, 6, 8, 0x4a7ab0); R(71, y, 6, 1, 0xa8d0f0); R(71, y + 4, 6, 1, 0x3a6a9a); }
  R(66, H / 2 - 12, 18, 24, 0x3a7a5a); R(70, H / 2 - 9, 10, 18, 0xf0c050); R(74, H / 2 - 9, 1, 18, 0xc89a30); // entrance canopy and door
  // pool: stone coping, water, lane ropes
  R(90, 20, 30, H - 44, 0xf4f0e0); R(92, 22, 26, H - 48, 0x4fc3e0); R(92, 22, 26, 2, 0x8fe0f0);
  for (let y = 34; y < H - 30; y += 10) R(94, y, 22, 1, 0xffffff);
  R(105, 22, 1, H - 48, 0xf0f8ff);
  for (let i = 0; i < 12; i++) R(95 + ((i * 7) % 16), 28 + i * 16, 4, 1, 0xd8f6ff);
  // loungers and parasols on the sea side of the pool
  const col = [0xe0483a, 0x3a8fe0, 0xf0c020, 0x3ab08a];
  for (let i = 0; i < 9; i++) {
    const y = 14 + i * 24;
    R(122, y, 8, 4, 0xffffff); R(122, y, 3, 4, 0x3a8fe0);
    g.circle(ox + 135, oy + y + 3, 5).fill({ color: 0x000000, alpha: 0.18 }).circle(ox + 134, oy + y + 2, 5).fill(col[i % 4]!);
    g.circle(ox + 134, oy + y + 2, 1).fill(0xffffff);
  }
  // flower beds, lamps and potted palms along the hotel
  for (let y = 16; y < H - 20; y += 40) { R(84, y, 4, 8, 0x2f8a3a); R(84, y + 1, 1, 1, 0xff6a8a); R(86, y + 4, 1, 1, 0xffd040); }
  for (const y of [10, H / 2 + 22, H - 14]) { R(82, y, 1, 4, 0x4a4a52); R(81, y - 1, 3, 2, 0xfff0a0); }
  for (const y of [40, H - 50]) { g.circle(ox + 86, oy + y, 4).fill(0x2f8a3a); g.circle(ox + 84, oy + y - 2, 2).fill(0x3a9a45); }
  // pier: planks over the water to a little hut
  const py = H / 2 - 3;
  for (let x = W; x < W + 48; x += 2) R(x, py, 2, 6, x % 4 ? 0x9a7248 : 0x8a6238);
  for (let x = W + 2; x < W + 48; x += 12) { R(x, py - 1, 2, 2, 0x5a3a22); R(x, py + 5, 2, 2, 0x5a3a22); }
  R(W + 40, py - 6, 14, 18, 0xe6d3a0); R(W + 40, py - 6, 14, 5, 0x3a8fe0); R(W + 40, py - 6, 14, 1, 0xffffff);
  return g;
}

/** A track and a station: platform under a canopy, lamps, a bench, and a building whose front (door, clock, flower beds) faces the road. */
function drawStation(rows: number): Container {
  const c = new Container();
  const g = new Graphics();
  const top = -FOREST * T, bottom = (rows + FOREST) * T, tx = RAIL_X * T;
  g.rect(tx + 2, top, 12, bottom - top).fill(0x6b6258); // ballast
  for (let y = top; y < bottom; y += 6) g.rect(tx + 1, y, 14, 2).fill(0x5a3a22); // sleepers
  g.rect(tx + 4, top, 2, bottom - top).fill(0xb8bcc4).rect(tx + 10, top, 2, bottom - top).fill(0xb8bcc4); // rails
  const y0 = (STATION.y - 1) * T, plen = (STATION.h + 3) * T;
  const px = (RAIL_X + 1) * T, pw = 2 * T;
  const bx = STATION.x * T, by = STATION.y * T, bw = STATION.w * T, bh = STATION.h * T;
  // paved forecourt from the road to the building, joined to the platform
  const fy = 18 * T, fx = px + pw;
  g.rect(fx, fy, bx + bw - fx, by + bh - fy).fill(0xc9bfa9);
  for (let y = fy; y < by + bh; y += 8) g.rect(fx, y, bx + bw - fx, 1).fill({ color: 0x000000, alpha: 0.07 });
  g.rect(fx, fy, 1, by + bh - fy).fill(0x8a8274);
  // platform with a yellow safety edge
  g.rect(px, y0, pw, plen).fill(0xa8a090).rect(px, y0, 3, plen).fill(0xf0c020);
  for (let y = y0 + 4; y < y0 + plen; y += 8) g.rect(px + 4, y, pw - 6, 1).fill({ color: 0x000000, alpha: 0.12 });
  // canopy: a pale roof with slats, a red trim and a shadow on the platform
  const cy = y0 + 6, ch = plen - 12;
  g.rect(px + 2, cy + 3, pw, ch).fill({ color: 0x000000, alpha: 0.18 });
  g.rect(px + 3, cy, pw - 3, ch).fill(0xdcd8cc).rect(px + 3, cy, pw - 3, 2).fill(0xc84a3a).rect(px + 3, cy + ch - 2, pw - 3, 2).fill(0xc84a3a);
  for (let y = cy + 6; y < cy + ch - 3; y += 6) g.rect(px + 3, y, pw - 3, 1).fill({ color: 0x000000, alpha: 0.14 });
  g.rect(px + 3 + ((pw - 3) >> 1), cy + 2, 1, ch - 4).fill({ color: 0xffffff, alpha: 0.5 });
  // bench and lamps on the platform's edge
  g.rect(px + pw - 6, y0 + plen - 20, 4, 12).fill(0x8a5a2a);
  for (const y of [y0 + 8, y0 + plen - 6]) g.circle(px + 6, y, 2).fill(0xf8e08a).circle(px + 6, y, 1).fill(0xffffff);
  g.rect(tx - 4, y0 - 12, 2, 8).fill(0x3a3a44).circle(tx - 3, y0 - 13, 2).fill(0xd23a2a); // signal
  // the building: wall and door on the road side (top), tiled roof behind it
  g.rect(bx + 2, by + 3, bw, bh).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(bx, by, bw, bh).fill(0x2a2a30).rect(bx + 1, by + 1, bw - 2, bh - 2).fill(0xb5483a);
  for (let r = by + 18; r < by + bh - 2; r += 5) g.rect(bx + 1, r, bw - 2, 1).fill({ color: 0x000000, alpha: 0.2 });
  g.rect(bx + 1, by + bh - 4, bw - 2, 2).fill({ color: 0xffffff, alpha: 0.3 });
  g.rect(bx + bw - 18, by + bh - 20, 8, 8).fill(0x6a3a2a).rect(bx + bw - 19, by + bh - 21, 10, 2).fill(0x4a2a1a); // chimney
  g.rect(bx + 1, by + 1, bw - 2, 14).fill(0xf0e4c8).rect(bx + 1, by + 14, bw - 2, 1).fill({ color: 0x000000, alpha: 0.25 }); // wall
  for (const i of [0, 1, 3, 4]) g.rect(bx + 6 + i * 15, by + 4, 9, 8).fill(0x2a2a30).rect(bx + 7 + i * 15, by + 5, 7, 6).fill(0xbfe0f0).rect(bx + 10 + i * 15, by + 5, 1, 6).fill(0x2a2a30);
  const dx = bx + (bw >> 1);
  g.rect(dx - 5, by + 1, 10, 14).fill(0x4a2e1a).rect(dx - 4, by + 2, 8, 12).fill(0x6a4630).rect(dx, by + 2, 1, 12).fill(0x2a1a10).rect(dx - 6, by, 12, 2).fill(0xb5483a); // double door with a small gable
  g.circle(dx, by + 20, 5).fill(0xf8f4e8).stroke({ color: 0x2a2a30, width: 1 }).rect(dx, by + 17, 1, 3).fill(0x2a2a30).rect(dx, by + 20, 3, 1).fill(0x2a2a30); // clock on the roof
  // flower beds either side of the path, a lamp each
  for (const sx of [bx + 2, bx + bw - 30]) {
    g.rect(sx, by - 6, 28, 4).fill(0x7a5a3a);
    for (let i = 0; i < 5; i++) g.circle(sx + 3 + i * 5, by - 6, 1.5).fill([0xf06a8a, 0xf0d040, 0xf0f0f0, 0xe0603a, 0xb070e0][i]!);
  }
  for (const lx of [bx - 4, bx + bw + 2]) g.rect(lx, by - 12, 1, 10).fill(0x3a3a44).circle(lx, by - 13, 2).fill(0xf8e08a);
  c.addChild(g);
  return c;
}

const TRAIN_LEN = 104;
/** Where the train's nose is at second `t` of its 36 s round: in from the bottom (5 s), waits at the platform (6 s), out the top (5 s), gone (20 s). */
export function trainY(t: number, startY: number, stopY: number, endY: number): number {
  const c = t % 36;
  if (c < 5) return startY + (stopY - startY) * (1 - (1 - c / 5) ** 2);
  if (c < 11) return stopY;
  if (c < 16) return stopY + (endY - stopY) * ((c - 11) / 5) ** 2;
  return endY;
}

const ROAD_Y = 15 * T, ROAD_H = 2 * T; // the main road crosses the track here
/** Barriers are down while any part of the train (nose at `y`, tail `TRAIN_LEN` below) is within 40px of the road. */
export const gateClosed = (y: number): boolean => y + TRAIN_LEN > ROAD_Y - 40 && y < ROAD_Y + ROAD_H + 40;
let barrierDown = false;
/** Are the barriers down right now? Cars read this to wait at the stop line. */
export const crossingClosed = (): boolean => barrierDown;
/** Tile-unit stop lines just short of each barrier arm; a car past its line keeps going and clears the track. */
export const STOP_WEST = RAIL_X - 0.6, STOP_EAST = RAIL_X + 1.4;
/** Must a car at (x, y) heading `dx` that is about to move to `nx` wait for the barrier? Only the main road at the crossing. */
export const holdAtGate = (closed: boolean, x: number, y: number, dx: number, nx: number): boolean =>
  closed && Math.abs(y - 16) <= 1 && ((dx > 0 && x < STOP_WEST && nx >= STOP_WEST) || (dx < 0 && x > STOP_EAST && nx <= STOP_EAST));

/** Level-crossing barriers on both sides of the track: the arm on each side blocks the lane that approaches it. */
function drawGate(g: Graphics, closed: boolean): void {
  g.clear();
  const tx = RAIL_X * T, mid = ROAD_Y + T;
  // west post on the south pavement guards the eastbound (south) lane; east post on the north pavement the westbound lane
  for (const [x, post, dir] of [[tx - 6, ROAD_Y + ROAD_H + 2, -1], [tx + 20, ROAD_Y - 6, 1]] as const) {
    g.rect(x - 1, post, 5, 4).fill(0x333338);
    g.circle(x + 1, post + 2, 1.5).fill(closed ? 0xff3030 : 0x403030);
    const len = closed ? 14 : 5; // lowered across the lane, raised to a short stub
    const y0 = closed ? (dir < 0 ? mid : post + 4) : dir < 0 ? post - len : post + 4;
    const y1 = closed ? (dir < 0 ? post : mid) : y0 + len;
    for (let yy = Math.min(y0, y1), i = 0; yy < Math.max(y0, y1); yy += 3, i++) g.rect(x, yy, 3, Math.min(3, Math.max(y0, y1) - yy)).fill(i % 2 ? 0xffffff : 0xd02020);
  }
}

// ---- passengers, on the same 36 s clock as the train ----
type Kf = { t: number; x: number; y: number; vis: boolean }; // vis: is the person seen from this key on, until the next one
const WALK = 96; // px per second: the city NPCs' pace (SPEED in actors.ts, 6 tiles/s)
const DOOR_X = STATION.x * T + (STATION.w * T >> 1), DOOR_Y = STATION.y * T + 2; // the ticket hall door, on the road side
const STREET_Y = ROAD_Y + ROAD_H - 8, AVE_X = 2 * T + 8; // the main road's south lane, and the city's west avenue it meets
const HOUSE = [22, 25, 22]; // tile rows of the west avenue's houses, whose doors people leave from and go home to
const homeY = (k: number) => HOUSE[k % HOUSE.length]! * T + 14; // feet on the avenue beside the door
const LANE = STATION.x * T - 16; // forecourt strip west of the building
/** A walk through `pts` from time `t0` at WALK px/s. */
const walk = (t0: number, pts: [number, number][]): Kf[] => {
  let t = t0;
  return pts.map(([x, y], i) => {
    if (i) t += Math.hypot(x - pts[i - 1]![0], y - pts[i - 1]![1]) / WALK;
    return { t, x, y, vis: true };
  });
};
const trainDoorY = (n: number) => (n % 2 ? 355 : 315); // one door per carriage
const BOARD_AT = 5.8, ALIGHT_AT = 5.5; // seconds into the cycle: the train has just stopped
let clockS = 0;
/** Seconds the train has run (0 until `drawTrain` ticks). */
export const trainClock = (): number => clockS;
/** ms from `fromS` until the train next stands at the platform (0 when exactly then). */
export const msToNextStop = (fromS: number): number => Math.round((((ALIGHT_AT - fromS) % 36) + 36) % 36 * 1000);
/** Tile waypoints, off-grid, from the main road's west end to the ticket-hall door. */
export const STATION_ROUTE: { x: number; y: number }[] = [{ x: -4, y: 16 }, { x: -4, y: 19 }];
/** The main road's west end inside the grid. */
export const CITY_EDGE: { x: number; y: number } = { x: 0, y: 16 };
/** Buy a ticket in the hall, walk round the building to the platform, wait, board. Ends hidden inside the train. */
function boarder(i: number): Kf[] {
  const ox = (i - 1) * 3, dy = trainDoorY(i), b = BOARD_AT + i;
  const inHall = walk(0, [[AVE_X + ox, homeY(i)], [AVE_X + ox, STREET_Y], [DOOR_X + ox, STREET_Y], [DOOR_X + ox, DOOR_Y]]);
  const door = inHall[inHall.length - 1]!;
  door.vis = false; // inside the ticket hall
  const out = walk(door.t + 2.5, [[DOOR_X + ox, DOOR_Y], [DOOR_X + ox, DOOR_Y - 10], [LANE, DOOR_Y - 10], [LANE, dy], [RAIL_X * T + 31, dy]]);
  const arrive = out[out.length - 1]!.t;
  out[0]!.vis = true;
  const wait: Kf = { t: b - 1.6, x: RAIL_X * T + 31, y: dy, vis: true }; // waits behind the yellow line, then steps to the carriage
  const aboard = { t: b, x: RAIL_X * T + 14, y: dy, vis: false };
  const all = [...inHall, ...out, wait, aboard];
  const shift = wait.t - arrive; // so the wait ends exactly when boarding starts
  return all.map((k, n) => ({ ...k, t: n < inHall.length + out.length ? k.t + shift : k.t }));
}
/** Step off the train, cross the forecourt and leave by the road. */
const alighter = (j: number): Kf[] => {
  const dy = trainDoorY(j), ox = (j - 1) * 3, a = ALIGHT_AT + 0.7 * j;
  return walk(a, [[RAIL_X * T + 14, dy], [LANE, dy], [LANE, DOOR_Y - 12], [DOOR_X + ox, DOOR_Y - 12], [DOOR_X + ox, STREET_Y], [AVE_X + ox, STREET_Y], [AVE_X + ox, homeY(j + 1)]]);
};
const COLORS = [0xd9534f, 0x4a90d9, 0xf0c040, 0x5cb85c, 0xb070e0, 0xf08a40];
const people: { kf: Kf[]; color: number }[] = [0, 1, 2].map((i) => ({ kf: boarder(i), color: COLORS[i]! })).concat([0, 1, 2].map((j) => ({ kf: alighter(j), color: COLORS[3 + j]! })));

/** Who is in view at second `c` of the cycle, and where. */
export function crowd(c: number): { n: number; x: number; y: number; dx: number; moving: boolean; color: number }[] {
  const out: { n: number; x: number; y: number; dx: number; moving: boolean; color: number }[] = [];
  for (const [n, { kf, color }] of people.entries())
    for (const tau of [c, c - 36]) { // a walk can start before the cycle does
      const k = kf.findIndex((p, n) => p.t <= tau && n + 1 < kf.length && tau < kf[n + 1]!.t);
      if (k < 0 || !kf[k]!.vis) continue;
      const a = kf[k]!, b = kf[k + 1]!, f = (tau - a.t) / (b.t - a.t);
      out.push({ n, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: Math.sign(b.x - a.x), moving: a.x !== b.x || a.y !== b.y, color });
    }
  return out;
}

const plainPerson = (color: number): Container => {
  const c = new Container();
  c.addChild(new Graphics().rect(-2, -10, 4, 3).fill(0xf0d0b0).rect(-2, -7, 4, 5).fill(color).rect(-2, -2, 1, 2).fill(0x2a2a30).rect(1, -2, 1, 2).fill(0x2a2a30));
  return c;
};

/** The train on the track: a loco and two carriages that stop at the station every so often; animates itself until destroyed. */
export function drawTrain(rows: number, figure?: (n: number) => Container): Container {
  const g = new Graphics();
  const lx = RAIL_X * T + 2, tw = 12;
  const car = (y: number, h: number, body: number, roof: number) => {
    g.rect(lx - 1, y - 1, tw + 2, h + 2).fill(0x2a2a30).rect(lx, y, tw, h).fill(body).rect(lx + 2, y + 2, tw - 4, h - 4).fill(roof);
    for (let w = y + 4; w < y + h - 5; w += 7) g.rect(lx, w, 2, 4).fill(0xbfe0f0).rect(lx + tw - 2, w, 2, 4).fill(0xbfe0f0);
  };
  car(0, 22, 0x2f5fb0, 0xe8eef8); // loco
  g.rect(lx + 2, 2, tw - 4, 6).fill(0xf0c020).rect(lx + 5, 12, 2, 6).fill(0x1a2f60);
  car(24, 38, 0xd9d9de, 0xf4f4f8);
  car(64, 38, 0xd9d9de, 0xf4f4f8);
  const crowdG = new Container(); // the people: city sprites when `figure` is given, else plain blocks
  const folk = new Map<number, Container>();
  const gate = new Graphics();
  drawGate(gate, false);
  let closed = false;
  const startY = (rows + FOREST) * T, stopY = (STATION.y - 2) * T, endY = -FOREST * T - TRAIN_LEN; // runs north: the loco leads
  let t = 0;
  g.position.y = startY;
  const step = (tk: Ticker) => {
    if (g.destroyed) return void Ticker.shared.remove(step);
    t += tk.deltaMS / 1000;
    clockS = t;
    g.position.y = trainY(t, startY, stopY, endY);
    g.visible = g.position.y > endY;
    for (const f of folk.values()) f.visible = false;
    for (const p of crowd(t % 36)) {
      let f = folk.get(p.n);
      if (!f) {
        f = figure ? figure(p.n) : plainPerson(people[p.n]!.color);
        folk.set(p.n, f);
        crowdG.addChild(f);
      }
      f.visible = true;
      f.position.set(p.x, p.y + 4 - (p.moving ? Math.floor(t * 8) % 2 : 0)); // feet; the same 1px step-bob (every 125 ms) as the city NPCs
      if (p.dx) f.scale.x = p.dx < 0 ? -1 : 1;
    }
    const now = g.visible && gateClosed(g.position.y);
    barrierDown = now;
    if (now !== closed) drawGate(gate, (closed = now));
  };
  Ticker.shared.add(step);
  const c = new Container();
  c.eventMode = "none";
  c.addChild(gate, crowdG, g);
  return c;
}

const SHADES = [0xffffff, 0xffffff, 0xe4f0dc, 0xd0e4c4, 0xf0f8e8, 0xffffff, 0xc8dcbc];

/** The forest as sprites (or plain shapes without the tile sheet), positioned in map pixels, negative around the city. */
export function drawForest(sheets: Sheets | null, cols: number, rows: number, cityRows: number, roads: Road[], riverLeft: (y: number) => number): Container {
  const plan = planForest(cols, rows, cityRows, roads, riverLeft);
  const root = new Container();
  const river = () => {
    const w = new Graphics();
    for (const t of plan.water) {
      w.rect(t.x * T, t.y * T, T, T).fill(t.deep ? 0x2f7fc0 : 0x3a8fd0);
      if (t.bankL) w.rect(t.x * T, t.y * T, 3, T).fill(0xd8c088);
      if (t.bankR) w.rect(t.x * T + T - 3, t.y * T, 3, T).fill(0xd8c088);
    }
    return w;
  };
  if (sheets) {
    const put = (i: number, x: number, y: number, tint = 0xffffff) => {
      const sp = new Sprite(sheets.city(i));
      sp.position.set(x * T, y * T);
      sp.tint = tint;
      root.addChild(sp);
    };
    for (const g of plan.ground) put(g.tile, g.x, g.y);
    root.addChild(river(), drawBeach(plan), drawResort(cols));
    for (const b of plan.bushes) put(K.BUSH, b.x, b.y);
    for (const t of plan.trees) {
      put(K.TREE_TOP, t.x, t.y - 1, SHADES[t.shade]);
      put(K.TREE_BOTTOM, t.x, t.y, SHADES[t.shade]);
    }
    root.addChild(drawStation(rows));
    return root;
  }
  const g = new Graphics();
  root.addChild(g, river(), drawBeach(plan), drawResort(cols));
  for (const t of plan.ground) g.rect(t.x * T, t.y * T, T, T).fill(t.road ? 0x4a4a52 : t.walk ? 0xc2b8a4 : 0x5a9e4b);
  for (const t of plan.trees) {
    const px = t.x * T, py = t.y * T;
    g.rect(px + 7, py + 10, 2, 4).fill(0x6b4a2b);
    g.rect(px + 2, py - 12, 12, 22).fill(0x2f6f35);
    g.rect(px + 4, py - 12, 4, 4).fill(0x4a9a4a);
  }
  root.addChild(drawStation(rows));
  return root;
}
