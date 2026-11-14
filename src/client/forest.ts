import { Container, Graphics, Sprite } from "pixi.js";
import * as K from "./tiles.js";
import type { Sheets } from "./tiles.js";
import { onRoad, type Road } from "./roads.js";
import type { Pt } from "./path.js";

const T = 16;
/** Tiles of forest around the city: enough to fill a wide window. */
export const FOREST = 24;

const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;

export interface ForestPlan {
  /** every tile of the square: grass, a road tile (road: true), or the sidewalk beside a road (walk: true); under the city it is plain grass, so no gap shows at the map's edge */
  ground: { x: number; y: number; tile: number; road: boolean; walk: boolean }[];
  /** trees stand on `y` with the crown on the tile above; the list is in drawing order (top to bottom) */
  trees: (Pt & { shade: number })[];
  bushes: Pt[];
  /** the river carried on through the forest; banks are the sides where the water ends */
  water: (Pt & { deep: boolean; bankL: boolean; bankR: boolean })[];
}

/**
 * What the forest holds: the tiles of the square [-FOREST, cols+FOREST) × [-FOREST, rows+FOREST). The city itself
 * (columns 0..cols-1, rows 0..cityRows-1) gets only grass: the map drawn above covers it. Roads leaving the city carry
 * a sidewalk on both sides; trees keep clear of them.
 */
export function planForest(cols: number, rows: number, cityRows: number, roads: Road[], riverLeft: (y: number) => number): ForestPlan {
  const wet = (x: number, y: number) => x >= riverLeft(y) && x < riverLeft(y) + 3;
  const inside = (x: number, y: number) => x >= 0 && x < cols && y >= 0 && y < cityRows;
  const road = (x: number, y: number) => roads.find((r) => onRoad(r, x, y));
  const nearRoad = (x: number, y: number) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (road(x + i, y + j)) return true;
    return false;
  };
  const nearWater = (x: number, y: number) => wet(x - 1, y) || wet(x + 1, y);
  const plan: ForestPlan = { ground: [], trees: [], bushes: [], water: [] };
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
        continue;
      }
      plan.ground.push({ x, y, tile: K.GRASS[h % K.GRASS.length]!, road: false, walk: false });
      if (nearWater(x, y)) continue;
      if (h % 3 !== 0 && !inside(x, y - 1)) plan.trees.push({ x, y, shade: h % 7 });
      else if (h % 5 === 1) plan.bushes.push({ x, y });
    }
  return plan;
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
    root.addChild(river());
    for (const b of plan.bushes) put(K.BUSH, b.x, b.y);
    for (const t of plan.trees) {
      put(K.TREE_TOP, t.x, t.y - 1, SHADES[t.shade]);
      put(K.TREE_BOTTOM, t.x, t.y, SHADES[t.shade]);
    }
    return root;
  }
  const g = new Graphics();
  root.addChild(g, river());
  for (const t of plan.ground) g.rect(t.x * T, t.y * T, T, T).fill(t.road ? 0x4a4a52 : t.walk ? 0xc2b8a4 : 0x5a9e4b);
  for (const t of plan.trees) {
    const px = t.x * T, py = t.y * T;
    g.rect(px + 7, py + 10, 2, 4).fill(0x6b4a2b);
    g.rect(px + 2, py - 12, 12, 22).fill(0x2f6f35);
    g.rect(px + 4, py - 12, 4, 4).fill(0x4a9a4a);
  }
  return root;
}
