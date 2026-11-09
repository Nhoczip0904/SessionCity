/// <reference types="vite/client" />
import { Assets, Rectangle, Texture } from "pixi.js";
import cityUrl from "../../assets/kenney/roguelike-modern-city/tilemap_packed.png?url";
import charUrl from "../../assets/kenney/roguelike-characters/roguelikeChar_transparent.png?url";

export interface Sheets {
  city(index: number): Texture;
  char(col: number, row: number): Texture;
}

const CITY_COLS = 37;

export async function loadSheets(load: (url: string) => Promise<Texture> = (u) => Assets.load<Texture>(u)): Promise<Sheets | null> {
  let city: Texture, char: Texture;
  try {
    [city, char] = await Promise.all([load(cityUrl), load(charUrl)]);
  } catch {
    return null;
  }
  const cache = new Map<string, Texture>();
  const cut = (sheet: Texture, x: number, y: number) => {
    const key = `${sheet.uid}:${x},${y}`;
    let t = cache.get(key);
    if (!t) cache.set(key, (t = new Texture({ source: sheet.source, frame: new Rectangle(x, y, 16, 16) })));
    return t;
  };
  return {
    city: (i) => cut(city, (i % CITY_COLS) * 16, Math.floor(i / CITY_COLS) * 16),
    char: (c, r) => cut(char, c * 17, r * 17), // 1 px spacing
  };
}

// --- roguelike-modern-city tile indices (row * 37 + col) ---

// ground
export const GRASS = [888, 889];
export const DIRT = 892;
export const SIDEWALK = 747;
// sidewalk edge pieces, named by the side the road is on
export const SIDEWALK_N = 710, SIDEWALK_S = 821, SIDEWALK_W = 746, SIDEWALK_E = 748;
export const SIDEWALK_NW = 709, SIDEWALK_NE = 711, SIDEWALK_SW = 820, SIDEWALK_SE = 822;

// roads
export const ROAD = 714;
export const ROAD_DASH_H = 860; // dash on the tile's top edge (lower lane of a 2-lane road)
export const ROAD_DASH_V = 786; // dash on the tile's right edge (left lane of a 2-lane road)
export const CROSSWALK_H = 826; // stripes across a horizontal road
export const CROSSWALK_V = 823; // stripes across a vertical road
export const PARKING = 901;

// props
export const TREE_TOP = 403, TREE_BOTTOM = 440;
export const BUSH = 514;
export const LAMP_TOP = 633, LAMP_BOTTOM = 670;
export const BENCH = 570;
export const CRATE = 605;
export const BARREL = 497;
export const CONE = 680;
export const BARRIER = 209;
// parked cars, 3×2 tiles (top row, bottom row)
export const CARS = [
  [623, 624, 625, 660, 661, 662],
  [771, 772, 773, 808, 809, 810],
  [919, 920, 921, 956, 957, 958],
];

// roofs: 9-slice per colour, laid out from a base index
export interface Roof { tl: number; t: number; tr: number; l: number; c: number; r: number; bl: number; b: number; br: number }
const roof = (b: number): Roof => ({ tl: b, tr: b + 1, t: b + 2, l: b + 3, c: b + 6, bl: b + 37, br: b + 38, b: b + 39, r: b + 40 });
export const ROOF_RED = roof(0), ROOF_DARK = roof(8), ROOF_LIGHT = roof(16), ROOF_SAND = roof(24);

// facades: [left, middle, right] for an upper and a ground-floor row
export interface Wall { top: number[]; base: number[] }
const wall = (c: number): Wall => ({ top: [185 + c, 186 + c, 188 + c], base: [296 + c, 297 + c, 299 + c] });
export const WALL_BRICK = wall(0), WALL_GRAY = wall(4), WALL_SAND = wall(8);
export const WALL_GLASS: Wall = { top: [235, 236, 237], base: [309, 310, 311] };
export const WALL_WHITE: Wall = { top: [349, 350, 351], base: [386, 387, 388] };

// windows and doors (drawn over a facade tile); 2-tall pieces are [top, bottom]
export const WIN_BROWN = 617, WIN_GRAY = 729;
export const WIN_ARCH = [583, 620];
export const DOOR_GLASS = [800, 837], DOOR_DARK = [804, 841], DOOR_WOOD = [583, 620];
export const SHUTTER = [880, 917];
