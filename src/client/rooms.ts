import type { District, Employee, Session, SessionDetail } from "../shared/types.js";
import type { PickKind } from "./actors.js";
import type { Pt } from "./path.js";
import * as K from "./tiles.js";

export const ROOM_COLS = 16, ROOM_ROWS = 12, MAX_DESKS = 12;
/** Wall face rows 0–1 (board on x BOARD_X..BOARD_X+BOARD_W−1), door at x 7–8 on the last row. */
export const BOARD_X = 3, BOARD_W = 10;

export type Furniture = "safe" | "cabinet" | "phone" | "map" | "shelf";
/** `tiles` laid out `w` wide from (x, y); y < 2 hangs on the wall */
export interface Prop { tiles: number[]; w: number; x: number; y: number; name?: string; action?: Furniture; leds?: boolean; /** tiles from the city sheet */ city?: boolean }
export type FloorKind = "wood" | "tile" | "concrete";
/** Procedural, partly animated set piece that makes a department recognisable. */
export type Layout = "office" | "hall";
export type Spot = Pt & { big?: boolean; /** sits below its desk, facing up */ back?: boolean };
export type Decor = "shelves" | "pinboard" | "worksite" | "racks" | "flasks" | "diff" | "conveyor" | "carousel" | "radar" | "fireplace" | "stage";
export interface RoomTheme {
  floor: number; wall: number; kind: FloorKind;
  /** x of 2-wide wall windows */ windows: number[];
  /** colour of a carpet runner from the door to the front */ runner?: number;
  /** rugs in tiles: [x, y, w, h, colour] */ rugs?: [number, number, number, number, number][];
  decor?: Decor;
  /** colour light over the whole room: [colour, alpha] */ tint?: [number, number];
  /** workstation look: 2 desk tiles (left, right), whether it carries a screen */ desk?: { tiles: number[]; monitor: boolean };
  /** "hall": one big desk, everyone else waits on chairs */ layout?: Layout;
  props: Prop[];
}

const row = (tiles: number[], x: number, y = 2, extra: Partial<Prop> = {}): Prop => ({ tiles, w: tiles.length, x, y, ...extra });
const tall = (tiles: number[], x: number, y = 2, extra: Partial<Prop> = {}): Prop => ({ tiles, w: 1, x, y, ...extra });
const block = (tiles: number[], w: number, x: number, y: number): Prop => ({ tiles, w, x, y });
const one = (t: number, x: number, y = 2) => row([t], x, y);
const city = (t: number, x: number, y: number) => row([t], x, y, { city: true });
/** Plants in the two front corners, beside the door wall. */
const corners = [one(K.IN_PLANT, 0, 10), one(K.IN_PLANT2, 15, 10)];

export const ROOM_THEMES: Partial<Record<District, RoomTheme>> = {
  // reading room: shelves on every wall, warm lamp light, long reading table
  library: { floor: 0x7a4f30, wall: 0xd9c3a0, kind: "wood", windows: [], decor: "shelves", tint: [0xffb060, 0.07], rugs: [[5, 2.6, 6, 3, 0x2f5d50]],
    desk: { tiles: [K.IN_TABLE[0], K.IN_TABLE[2]], monitor: false }, props: [
    row(K.IN_BOOKSHELF, 0), row(K.IN_BOOKSHELF, 3), row(K.IN_BOOKSHELF, 10), row(K.IN_BOOKSHELF, 13),
    block(K.IN_TABLE, 3, 6.5, 3), one(K.IN_STOOL, 5.5, 3.5), one(K.IN_STOOL, 9.5, 3.5), one(K.IN_CANDLE, 7, 2), one(K.IN_CANDLE, 8, 2),
    ...[3, 4, 5, 6, 7, 8, 9, 10].flatMap((y) => [one(K.IN_BOOKSHELF[y % 3], 0, y), one(K.IN_BOOKSHELF[(y + 1) % 3], 15, y)])] },
  // studio: cork pinboard full of sticky notes, blueprint table
  design: { floor: 0xc49a68, wall: 0xa9d2f0, kind: "wood", windows: [14], decor: "pinboard", rugs: [[5.5, 2.6, 5, 3, 0x2f5f9f]], props: [
    row(K.IN_CHART, 4), row(K.IN_BENCH, 10), one(K.IN_PLANT, 15), block(K.IN_OVAL_TABLE, 2, 7, 3), ...corners] },
  // building site: hazard tape, cones, crates, ladders, bare workbenches
  site: { floor: 0x9a8f80, wall: 0xe0b060, kind: "concrete", windows: [14], decor: "worksite",
    desk: { tiles: [K.IN_COUNTER[0], K.IN_COUNTER[2]], monitor: true }, props: [
    tall(K.IN_LADDER, 0), tall(K.IN_LADDER, 1), city(K.CRATE, 6, 3), city(K.CRATE, 7, 3), city(K.BARREL, 9, 3), city(K.CONE, 5, 4), city(K.CONE, 10, 4),
    city(K.BARRIER, 3, 2), city(K.BARRIER, 12, 2)] },
  // server hall: rack rows with blinking lights, raised floor, cold light
  database: { floor: 0x353b50, wall: 0x7e8398, kind: "tile", windows: [], decor: "racks", tint: [0x4080ff, 0.08], props: [
    ...[0, 1, 2, 12, 13, 14, 15].map((x) => tall(K.IN_SERVER, x, 2, { leds: true })),
    ...[5, 6, 9, 10].map((x) => tall(K.IN_SERVER, x, 3, { leds: true })), one(K.IN_CLOCK, 1, 0.4)] },
  // test lab: lab benches as desks, bubbling flasks, results board
  lab: { floor: 0xe2eaec, wall: 0x9fd8b0, kind: "tile", windows: [14], decor: "flasks", tint: [0x80ffb0, 0.04],
    desk: { tiles: [K.IN_LAB[0], K.IN_LAB[2]], monitor: false }, props: [
    row(K.IN_LAB2, 13), one(K.IN_SINK, 12), block(K.IN_TABLE, 3, 6.5, 3), ...corners] },
  // review chamber: diff screen, meeting table with chairs, dark carpet
  review: { floor: 0x5e4254, wall: 0xdccbe8, kind: "wood", windows: [], decor: "diff", rugs: [[5, 2.6, 6, 3, 0x3d2f52]], props: [
    row(K.IN_TAPESTRY, 13, 0.4), row(K.IN_BOOKSHELF, 13), block(K.IN_CLOTH_TABLE, 3, 6.5, 3),
    one(K.IN_CHAIR_SIDE[0], 5.5, 3.5), one(K.IN_CHAIR_SIDE[1], 9.5, 3.5), one(K.IN_PLANT, 4), one(K.IN_PLANT2, 11), ...corners] },
  // factory floor: conveyor belt across the hall, machines, workbenches
  factory: { floor: 0x77736a, wall: 0xb8a890, kind: "concrete", windows: [], decor: "conveyor",
    desk: { tiles: [K.IN_COUNTER[0], K.IN_COUNTER[2]], monitor: false }, props: [
    tall(K.IN_MACHINE, 0), tall(K.IN_MACHINE, 1), tall(K.IN_MACHINE, 14), tall(K.IN_MACHINE, 15),
    tall(K.IN_SPEAKER, 3), tall(K.IN_SPEAKER, 12), one(K.IN_PIPE, 6), one(K.IN_PIPE, 9), one(K.IN_CLOCK, 1, 0.4)] },
  // terminal: baggage carousel, departure board, check-in counters
  airport: { floor: 0xc3c8ce, wall: 0xc8ccd0, kind: "tile", windows: [14], decor: "carousel",
    desk: { tiles: [K.IN_COUNTER[0], K.IN_COUNTER[2]], monitor: true }, props: [
    row(K.IN_BENCH, 12), one(K.IN_PLANT, 3), city(K.BARRIER, 4, 2), ...corners] },
  // control room: wall of live screens, radar sweep, dim light
  watchtower: { floor: 0x45523f, wall: 0x8f9888, kind: "tile", windows: [], decor: "radar", tint: [0x002010, 0.18], props: [
    tall(K.IN_SERVER, 6, 2, { leds: true }), tall(K.IN_SERVER, 9, 2, { leds: true })] },
  // living room: fireplace, piano, armchairs, warm light
  home: { floor: 0xa8704a, wall: 0xf2d8b8, kind: "wood", windows: [14], decor: "fireplace", tint: [0xff9040, 0.06], rugs: [[5.5, 2.6, 5, 3, 0x9c3d3d]],
    desk: { tiles: [K.IN_TABLE[0], K.IN_TABLE[2]], monitor: false }, props: [
    block(K.IN_PIANO, 2, 3.5, 2), tall(K.IN_ARMCHAIR, 12), tall(K.IN_ARMCHAIR, 13), one(K.IN_PLANT, 15),
    block(K.IN_OVAL_TABLE, 2, 7, 3), ...corners] },
  // assembly hall: the one big desk on the stage, banners, red carpet, rows of waiting chairs
  townhall: { floor: 0x9c6a3a, wall: 0xf0e2c0, kind: "wood", windows: [], decor: "stage", runner: 0x8e2b2b, layout: "hall", props: [
    tall(K.IN_BANNER, 1, 0), tall(K.IN_BANNER2, 14, 0), one(K.IN_CANDLE, 0), one(K.IN_CANDLE, 15), ...corners] },
};
export const DEFAULT_THEME: RoomTheme = { floor: 0x8f6a48, wall: 0xd8ccb8, kind: "wood", windows: [], props: [...corners] };
export const OFFICE_THEME: RoomTheme = {
  ...DEFAULT_THEME,
  windows: [0],
  tint: [0xffd090, 0.04],
  rugs: [[4.5, 2.6, 7, 3, 0x6b2f3a]],
  props: [
    one(K.IN_CLOCK, 2, 0.4),
    row([K.IN_SAFE], 0, 2, { name: "Két token", action: "safe" }),
    row([K.IN_CABINET], 1, 2, { name: "Tủ hồ sơ", action: "cabinet" }),
    one(K.IN_TABLE[1], 3), row([K.IN_PHONE], 3, 2, { name: "Điện thoại", action: "phone" }),
    one(K.IN_PLANT, 5),
    row(K.IN_MAP, 13.5, 0.4, { name: "Bản đồ", action: "map" }),
    one(K.IN_PLANT2, 10),
    row(K.IN_BOOKSHELF, 12, 2, { name: "Kệ sách", action: "shelf" }),
    one(K.IN_PLANT, 15),
    ...corners,
  ],
};

export type Occupant = { kind: PickKind; id: string; name: string; badge: "" | "!" | "z"; done: boolean };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const badge = (s: Session["status"]) => (s === "waiting" ? "!" : s === "idle" ? "z" : "");
const cap = (all: Occupant[]) => ({ people: all.slice(0, MAX_DESKS), extra: Math.max(0, all.length - MAX_DESKS) });
const staffOcc = (e: Employee): Occupant => ({ kind: "employee", id: e.id, name: e.type, badge: "", done: e.status === "done" });

export function roomOccupants(d: District, sessions: Session[], employees: Employee[]) {
  const mayors = sessions.filter((s) => s.district === d).sort((a, b) => cmp(a.project, b.project) || cmp(a.id, b.id))
    .map((s): Occupant => ({ kind: "session", id: s.id, name: s.project, badge: badge(s.status), done: false }));
  const staff = employees.filter((e) => e.district === d && e.status === "working")
    .sort((a, b) => cmp(a.startedAt, b.startedAt) || cmp(a.id, b.id)).map(staffOcc);
  return cap([...mayors, ...staff]);
}

export function deskSpots(n: number, layout: Layout = "office"): Spot[] {
  const out: Spot[] = [];
  if (layout === "hall") {
    out.push({ x: 7, y: 3, big: true }); // the one desk, 3 wide on the stage
    for (const y of [5, 7, 9]) for (const x of [2, 5, 10, 13]) if (out.length < MAX_DESKS) out.push({ x, y }); // a chair, no desk
  } else {
    // two pods of 3 desks facing 3 desks, aisle to the door in between; 2-wide desks at x..x+1
    for (const x of [1, 3, 5, 9, 11, 13]) out.push({ x, y: 6 }); // chair row 6, desk row 7
    for (const x of [1, 3, 5, 9, 11, 13]) out.push({ x, y: 9, back: true }); // desk row 8, chair row 9
  }
  return out.slice(0, Math.min(n, MAX_DESKS));
}

const STATUS_VI = { working: "Đang làm", waiting: "Chờ bạn", idle: "Rảnh" };

export function officeLayout(d: SessionDetail) {
  const working = d.staff.filter((e) => e.status === "working").sort((a, b) => cmp(a.startedAt, b.startedAt));
  const done = d.staff.filter((e) => e.status === "done").sort((a, b) => cmp(b.endedAt ?? "", a.endedAt ?? ""));
  const p = d.lastPrompt;
  const prompt = !p ? "—" : p.length > 120 ? p.slice(0, 119) + "…" : p;
  const { people, extra } = cap([...working, ...done].map(staffOcc));
  return { staff: people, extra, board: [d.title ?? d.project, STATUS_VI[d.status], prompt] };
}

const fmt = (n: number) => n.toLocaleString("vi-VN");

export function tokenRows(d: SessionDetail): { rows: string[][]; total: string[]; staff: number } | null {
  const models = Object.entries(d.tokens.byModel);
  if (!models.length) return null;
  const t = d.tokens;
  return {
    rows: models.map(([m, c]) => [m, fmt(c.input), fmt(c.output), fmt(c.cacheRead), fmt(c.cacheWrite)]),
    total: ["Tổng", fmt(t.input), fmt(t.output), fmt(t.cacheRead), fmt(t.cacheWrite)],
    staff: d.staff.reduce((s, e) => s + e.tokens.input + e.tokens.output + e.tokens.cacheRead + e.tokens.cacheWrite, 0),
  };
}

export const fileRows = (d: SessionDetail): Employee[] =>
  d.staff.filter((e) => e.status === "done").sort((a, b) => cmp(b.endedAt ?? "", a.endedAt ?? ""));
