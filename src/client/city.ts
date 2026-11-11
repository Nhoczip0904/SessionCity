import { Container, Graphics, Text } from "pixi.js";
import type { District } from "../shared/types.js";
import { districtInfo } from "../shared/districts.js";
import { drawTiles } from "./cityDraw.js";
import type { Pt } from "./path.js";
import type { Sheets } from "./tiles.js";

export const TILE = 16;
const COLS = 48, ROWS = 32;
// ring road + cross streets, each 2 tiles wide
export const ROAD_ROWS = [2, 3, 15, 16, 28, 29];
export const ROAD_COLS = [2, 3, 15, 16, 31, 32, 44, 45];
const isRoad = (x: number, y: number) =>
  (ROAD_ROWS.includes(y) && x >= 2 && x <= 45) || (ROAD_COLS.includes(x) && y >= 2 && y <= 29);

type Style = "ridge" | "tiles" | "flat";
interface Plot { id: District; x: number; y: number; w: number; h: number; up: boolean; roof: number; wall: number; style: Style }
// up = front (door) faces the road above, else the road below
const PLOTS: Plot[] = [
  { id: "library", x: 5, y: 4, w: 9, h: 5, up: true, roof: 0x8b4a3c, wall: 0xd9c3a0, style: "tiles" },
  { id: "design", x: 5, y: 10, w: 9, h: 5, up: false, roof: 0x3f7fbf, wall: 0xa9d2f0, style: "flat" },
  { id: "database", x: 17, y: 4, w: 6, h: 5, up: true, roof: 0x5d6178, wall: 0xb0b4c8, style: "flat" },
  { id: "lab", x: 25, y: 4, w: 6, h: 5, up: true, roof: 0xdedee8, wall: 0x9fd8b0, style: "flat" },
  { id: "townhall", x: 18, y: 10, w: 12, h: 5, up: false, roof: 0xd8b04a, wall: 0xf0e2c0, style: "ridge" },
  { id: "review", x: 34, y: 4, w: 9, h: 5, up: true, roof: 0x8e5bb5, wall: 0xdccbe8, style: "tiles" },
  { id: "factory", x: 34, y: 10, w: 9, h: 5, up: false, roof: 0x7a6a58, wall: 0xb8a890, style: "flat" },
  { id: "watchtower", x: 5, y: 17, w: 9, h: 5, up: true, roof: 0x5d6e5a, wall: 0xa8b0a0, style: "flat" },
  { id: "home", x: 5, y: 23, w: 9, h: 5, up: false, roof: 0xc96b4b, wall: 0xf2d8b8, style: "ridge" },
  { id: "airport", x: 34, y: 17, w: 9, h: 5, up: true, roof: 0x8f969c, wall: 0xc8ccd0, style: "flat" },
  { id: "site", x: 34, y: 23, w: 9, h: 5, up: false, roof: 0xb8874a, wall: 0xe0b060, style: "flat" },
];
export const districtColors = (d: District) => {
  const p = PLOTS.find((q) => q.id === d)!;
  return { roof: p.roof, wall: p.wall };
};
// HQ row: 7 two-tile houses facing road row 16, 7 facing road row 28
const HQ: { x: number; y: number; up: boolean }[] = [];
for (let i = 0; i < 7; i++) HQ.push({ x: 17 + 2 * i, y: 17, up: true });
for (let i = 0; i < 7; i++) HQ.push({ x: 17 + 2 * i, y: 24, up: false });

const door = (x: number, y: number, h: number, up: boolean): Pt => ({ x, y: up ? y - 1 : y + h });
const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;
const FONT = 'Consolas, "DejaVu Sans Mono", "Courier New", monospace';
const LABEL_STYLE = { fontFamily: FONT, fontSize: 8, fill: 0xffffff, stroke: { color: 0x1a1a1a, width: 2 } };
const SIGN_STYLE = { fontFamily: FONT, fontSize: 7, fill: 0xf4ecd0 };

export function buildCity(sheets: Sheets | null) {
  const walkable = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => isRoad(x, y)));
  const doors = {} as Record<District, Pt>;
  for (const p of PLOTS) doors[p.id] = door(p.x + (p.w >> 1), p.y, p.h, p.up);
  const hqDoors = HQ.map((h) => door(h.x, h.y, 4, h.up));
  for (const d of [...Object.values(doors), ...hqDoors]) {
    if (!walkable[d.y][d.x]) throw new Error(`door ${d.x},${d.y} is not on a road`);
  }
  const built = new Set<number>();
  const mark = (x: number, y: number, w: number, h: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) built.add(j * COLS + i);
  };
  PLOTS.forEach((p) => mark(p.x, p.y, p.w, p.h));
  HQ.forEach((h) => mark(h.x, h.y, 2, 4));

  const plots = PLOTS.map((p) => ({ id: p.id, px: { x: p.x * TILE, y: p.y * TILE, w: p.w * TILE, h: p.h * TILE } }));
  const hqPlots = HQ.map((h) => ({ x: h.x * TILE, y: h.y * TILE, w: 2 * TILE, h: 4 * TILE }));

  function draw(): Container {
    const root = sheets
      ? drawTiles(sheets, { cols: COLS, rows: ROWS, isRoad, roadRows: ROAD_ROWS, roadCols: ROAD_COLS, plots: PLOTS, hq: HQ, built, hash })
      : drawProcedural();
    for (const p of PLOTS) {
      // tiles: centre of the roof (the facade takes the 2 road-side rows); procedural: centre of the plot
      const cy = sheets ? (p.y + (p.up ? 2 : 0) + (p.h - 2) / 2) * TILE : p.y * TILE + p.h * TILE / 2 + 2;
      drawLabel(root, p, Math.round(p.x * TILE + (p.w * TILE) / 2 - 1), Math.round(cy - 4));
    }
    const hqLabel = new Text({ text: "Trụ sở", style: LABEL_STYLE, resolution: 2 });
    hqLabel.anchor.set(0.5);
    hqLabel.position.set(24 * TILE, 22.5 * TILE);
    root.addChild(hqLabel);
    return root;
  }

  function drawProcedural(): Container {
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    const T = TILE;

    // grass with deterministic speckles
    g.rect(0, 0, COLS * T, ROWS * T).fill(0x5a9e4b);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const h = hash(x, y);
        g.rect(x * T + (h % 13), y * T + ((h >> 3) % 13), 2, 1).fill(0x4b8a3e);
        g.rect(x * T + ((h >> 2) % 13), y * T + ((h >> 5) % 13), 1, 1).fill(0x74b860);
      }

    // roads: asphalt, curbs, lane dashes between the two lanes
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        if (!isRoad(x, y)) continue;
        g.rect(x * T, y * T, T, T).fill(0x4a4a52);
        if (!isRoad(x, y - 1)) g.rect(x * T, y * T, T, 2).fill(0x9a9aa2);
        if (!isRoad(x, y + 1)) g.rect(x * T, y * T + T - 2, T, 2).fill(0x9a9aa2);
        if (!isRoad(x - 1, y)) g.rect(x * T, y * T, 2, T).fill(0x9a9aa2);
        if (!isRoad(x + 1, y)) g.rect(x * T + T - 2, y * T, 2, T).fill(0x9a9aa2);
        const hRoad = ROAD_ROWS.includes(y), vRoad = ROAD_COLS.includes(x) && y >= 2 && y <= 29;
        if (hRoad && vRoad) continue; // intersection: no dashes
        if (hRoad && ROAD_ROWS.includes(y + 1) && x % 2 === 0) g.rect(x * T + 4, y * T + T - 1, 8, 2).fill(0xe8d870);
        if (vRoad && !hRoad && ROAD_COLS.includes(x + 1) && y % 2 === 0) g.rect(x * T + T - 1, y * T + 4, 2, 8).fill(0xe8d870);
      }

    // trees on free grass
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        if (isRoad(x, y) || built.has(y * COLS + x) || hash(x, y) % 3) continue;
        const px = x * T, py = y * T;
        g.rect(px + 7, py + 10, 2, 4).fill(0x6b4a2b);
        g.rect(px + 3, py + 3, 10, 8).fill(0x2f6f35);
        g.rect(px + 5, py + 1, 6, 12).fill(0x2f6f35);
        g.rect(px + 5, py + 3, 4, 3).fill(0x4a9a4a);
      }

    for (const p of PLOTS) drawBuilding(g, p);
    HQ.forEach((h, i) => {
      const px = h.x * T, py = h.y * T, w = 2 * T, hh = 4 * T;
      g.rect(px + 1, py + 1, w - 2, hh - 2).fill(0x3a3a44);
      g.rect(px + 2, py + 2, w - 4, hh - 4).fill(i % 2 ? 0x8a7a68 : 0x7a8a98);
      for (let r = 0; r < 3; r++) g.rect(px + 6, py + 10 + r * 16, w - 12, 6).fill(0xbfe0f0);
      g.rect(px + 12, h.up ? py + 1 : py + hh - 5, 8, 4).fill(0x4a2e1a);
    });
    return root;
  }

  return { cols: COLS, rows: ROWS, walkable, doors, hqDoors, plots, hqPlots, draw };
}

/** Building name with a 1-line sign plaque under it. */
function drawLabel(root: Container, p: Plot, x: number, y: number) {
  const info = districtInfo(p.id);
  const t = new Text({ text: info.label, style: LABEL_STYLE, resolution: 2 });
  t.anchor.set(0.5);
  t.position.set(x, y);
  const sign = new Text({ text: info.sign, style: SIGN_STYLE, resolution: 2 });
  sign.anchor.set(0.5);
  sign.position.set(x, y + 10);
  const bw = Math.ceil(sign.width) + 6, bh = 10;
  const plaque = new Graphics()
    .rect(x - (bw >> 1), y + 5, bw, bh).fill(0x3a2a1c)
    .rect(x - (bw >> 1), y + 5, bw, bh).stroke({ color: 0xc8a060, width: 1, alignment: 1 });
  root.addChild(plaque, t, sign);
}

function drawBuilding(g: Graphics, p: Plot) {
  const T = TILE, x = p.x * T, y = p.y * T, w = p.w * T, h = p.h * T;
  g.rect(x + 2, y + 3, w - 2, h - 2).fill({ color: 0x000000, alpha: 0.25 }); // shadow
  g.rect(x, y, w - 2, h - 2).fill(0x2a2a30); // outline
  g.rect(x + 1, y + 1, w - 4, h - 4).fill(p.roof);
  const ix = x + 1, iy = y + 1, iw = w - 4, ih = h - 4;
  if (p.style === "ridge") {
    g.rect(ix, iy + (ih >> 1), iw, ih - (ih >> 1)).fill({ color: 0x000000, alpha: 0.18 });
    g.rect(ix, iy + (ih >> 1) - 1, iw, 2).fill({ color: 0xffffff, alpha: 0.35 });
  } else if (p.style === "tiles") {
    for (let r = iy + 4; r < iy + ih; r += 5) g.rect(ix, r, iw, 1).fill({ color: 0x000000, alpha: 0.25 });
  } else {
    g.rect(ix + 2, iy + 2, iw - 4, ih - 4).stroke({ color: 0xffffff, alpha: 0.2, width: 1 });
  }
  // per-district rooftop detail
  const cx = ix + (iw >> 1);
  switch (p.id) {
    case "townhall":
      g.rect(cx - 1, iy - 10, 2, 14).fill(0x3a3a3a);
      g.rect(cx + 1, iy - 10, 8, 5).fill(0xd94a3a);
      break;
    case "database":
      for (let i = 0; i < 3; i++) g.ellipse(ix + 14 + i * 28, iy + 34, 9, 6).fill(0x9aa0c0).stroke({ color: 0x3a3e55, width: 1 });
      break;
    case "lab":
      g.circle(cx, iy + 28, 14).fill(0x7fd0a0).stroke({ color: 0x2f6f55, width: 1 });
      g.rect(cx - 6, iy + 22, 4, 4).fill({ color: 0xffffff, alpha: 0.6 });
      break;
    case "factory":
      for (let i = 0; i < 3; i++) {
        g.rect(ix + 20 + i * 40, iy + 8, 10, 10).fill(0x3a3230);
        g.rect(ix + 22 + i * 40, iy - 2, 8, 6).fill({ color: 0xdddddd, alpha: 0.6 });
      }
      break;
    case "airport":
      g.rect(ix + 4, iy + (ih >> 1) - 4, iw - 8, 8).fill(0x5a6066);
      for (let i = ix + 8; i < ix + iw - 12; i += 14) g.rect(i, iy + (ih >> 1) - 1, 8, 2).fill(0xffffff);
      break;
    case "watchtower":
      g.rect(cx - 12, iy + 12, 24, 24).fill(0x4a5848).stroke({ color: 0x2a3028, width: 1 });
      g.rect(cx - 4, iy + 20, 8, 8).fill(0xf0d060);
      break;
    case "site":
      for (let i = ix; i < ix + iw - 4; i += 8) g.rect(i, iy, 4, 3).fill(0x222222).rect(i + 4, iy, 4, 3).fill(0xf0c020);
      g.rect(ix + 16, iy + 14, 22, 14).fill(0x8a6a3a);
      g.rect(ix + iw - 40, iy + 8, 3, 50).fill(0xf0c020);
      break;
    case "design":
      for (let i = ix + 6; i < ix + iw - 8; i += 12) g.rect(i, iy + 6, 8, ih - 12).fill({ color: 0xffffff, alpha: 0.25 });
      break;
    case "home":
      for (let i = 0; i < 3; i++) g.rect(ix + 12 + i * 44, iy + 6, 6, 8).fill(0x6a3a2a);
      break;
    default:
      break;
  }
  // facade strip + door on the road side
  g.rect(x + 1, p.up ? y + 1 : y + h - 7, w - 4, 4).fill(p.wall);
  g.rect(x + (p.w >> 1) * T + 4, p.up ? y : y + h - 8, 8, 6).fill(0x4a2e1a);
}
