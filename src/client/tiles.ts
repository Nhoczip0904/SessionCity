/// <reference types="vite/client" />
import { Assets, Rectangle, Texture } from "pixi.js";
import cityUrl from "../../assets/kenney/roguelike-modern-city/tilemap_packed.png?url";
import charUrl from "../../assets/kenney/roguelike-characters/roguelikeChar_transparent.png?url";
import indoorUrl from "../../assets/kenney/roguelike-indoors/roguelikeIndoor_transparent.png?url";

export interface Sheets {
  city(index: number): Texture;
  char(col: number, row: number): Texture;
  /** furniture sheet, index = row * 27 + col; absent if it failed to load */
  indoor?: (index: number) => Texture;
}

const CITY_COLS = 37;
const INDOOR_COLS = 27;

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
  let indoor: Texture | undefined;
  try {
    indoor = await load(indoorUrl);
  } catch {
    // optional: interiors just stay unavailable
  }
  const ind = indoor;
  return {
    indoor: ind && ((i) => cut(ind, (i % INDOOR_COLS) * 17, Math.floor(i / INDOOR_COLS) * 17)), // 1 px spacing
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
// moving cars, same colours as CARS (whose side view faces left): 2×2 views [tl, tr, bl, br]
export const CARS_UP = [[697, 698, 734, 735], [845, 846, 882, 883], [993, 994, 1030, 1031]]; // seen from behind
export const CARS_DOWN = [[699, 700, 736, 737], [847, 848, 884, 885], [995, 996, 1032, 1033]]; // seen from the front

// --- roguelike-indoors tile indices (row * 27 + col; furniture only, no floor/wall tiles) ---
export const IN_CHAIR = 55, IN_DESK = 86, IN_BIG_DESK = [112, 113, 114];
export const IN_PLANT = 16, IN_CANDLE = 19, IN_PAINTING = 343, IN_ARMCHAIR = 257;
export const IN_BOOKSHELF = [478, 479, 480]; // one row, left→right
export const IN_SERVER = [241, 268]; // [top, bottom]
export const IN_LAB = [329, 330]; // counters with bottles
export const IN_MACHINE = [392, 419]; // [top, bottom]
export const IN_MAP = [344, 345]; // framed map, 2 wide
export const IN_WINDOW = [400, 427]; // [top, bottom]
export const IN_BED = [12, 39]; // [top, bottom]
export const IN_LADDER = [237, 264]; // [top, bottom]
export const IN_WHITEBOARD = [371, 372];
export const IN_RUG = [232, 233, 234, 259, 260, 261]; // 3×2
export const IN_SAFE = 266, IN_CABINET = 328, IN_PHONE = 129;

// --- roguelikeChar_transparent.png frames [col, row] ---
export type Frame = readonly [number, number];
export const CHAR_BODY: Frame = [0, 0];
export const PANTS: Frame = [3, 0], SHOES: Frame = [4, 0];
export const HAIR: Frame = [19, 0], MAYOR_HAIR: Frame = [23, 0];
export const HAT: Frame = [28, 8];
export const MAGNIFIER: Frame = [37, 0], SCROLL: Frame = [36, 1];
// shirt colour blocks (orange, teal, lavender, green, gray, black): top-left of a 4×3 group that is laid out the same in each colour
export const SHIRT_COLORS: Frame[] = [[6, 0], [10, 0], [14, 0], [6, 5], [10, 5], [14, 5]];
// offsets inside a colour block
export const TSHIRT: Frame = [0, 0], SHIRT: Frame = [1, 0], JACKET: Frame = [1, 1], SUIT: Frame = [2, 1];

/** `own`: `shirt` is an offset inside the session's colour block; otherwise an absolute frame. */
export interface Outfit { shirt: Frame; own: boolean; hair: Frame; hat?: Frame; item?: Frame }
export const OUTFIT_MAYOR: Outfit = { shirt: SUIT, own: true, hair: MAYOR_HAIR, hat: HAT };
export const OUTFIT_EXPLORE: Outfit = { shirt: JACKET, own: true, hair: HAIR, item: MAGNIFIER };
export const OUTFIT_PLAN: Outfit = { shirt: SHIRT, own: true, hair: HAIR, item: SCROLL };
export const OUTFIT_GENERAL: Outfit = { shirt: TSHIRT, own: true, hair: HAIR };
export const OUTFIT_REVIEW: Outfit = { shirt: [12, 6], own: false, hair: HAIR }; // gray suit
export const OUTFIT_TEST: Outfit = { shirt: [12, 4], own: false, hair: HAIR }; // white coat
export const OUTFIT_OTHER: Outfit = { shirt: [10, 5], own: false, hair: HAIR }; // gray t-shirt
export const OUTFIT_CITIZEN: Outfit = { shirt: [7, 5], own: false, hair: HAIR }; // green shirt
