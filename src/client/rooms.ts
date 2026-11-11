import type { District, Employee, Session, SessionDetail } from "../shared/types.js";
import type { PickKind } from "./actors.js";
import { districtColors } from "./city.js";
import type { Pt } from "./path.js";
import * as K from "./tiles.js";

export const ROOM_COLS = 16, ROOM_ROWS = 11, MAX_DESKS = 12;

export type Furniture = "safe" | "cabinet" | "phone" | "map" | "shelf";
/** `tiles` laid out `w` wide from (x, y) */
export interface Prop { tiles: number[]; w: number; x: number; y: number; name?: string; action?: Furniture }
export interface RoomTheme { floor: number; wall: number; props: Prop[] }

const row = (tiles: number[], x: number, y = 2, extra: Partial<Prop> = {}): Prop => ({ tiles, w: tiles.length, x, y, ...extra });
const tall = (tiles: number[], x: number, y = 2, extra: Partial<Prop> = {}): Prop => ({ tiles, w: 1, x, y, ...extra });
const plant = (x: number) => row([K.IN_PLANT], x);
const colors = (d: District) => {
  const c = districtColors(d);
  return { floor: c.roof, wall: c.wall };
};

export const ROOM_THEMES: Partial<Record<District, RoomTheme>> = {
  library: { ...colors("library"), props: [row(K.IN_BOOKSHELF, 1), row(K.IN_BOOKSHELF, 5), plant(14)] },
  design: { ...colors("design"), props: [row(K.IN_WHITEBOARD, 2), row([K.IN_PAINTING], 6)] },
  site: { ...colors("site"), props: [tall(K.IN_LADDER, 2), row([K.IN_DESK], 5)] },
  database: { ...colors("database"), props: [tall(K.IN_SERVER, 2), tall(K.IN_SERVER, 4), tall(K.IN_SERVER, 6)] },
  lab: { ...colors("lab"), props: [row(K.IN_LAB, 2), row(K.IN_LAB, 5), plant(14)] },
  review: { ...colors("review"), props: [row([K.IN_PAINTING], 2), row([K.IN_PAINTING], 4), row(K.IN_BOOKSHELF, 8)] },
  factory: { ...colors("factory"), props: [tall(K.IN_MACHINE, 2), tall(K.IN_MACHINE, 5)] },
  airport: { ...colors("airport"), props: [row(K.IN_MAP, 2), tall(K.IN_WINDOW, 6), tall(K.IN_WINDOW, 9)] },
  watchtower: { ...colors("watchtower"), props: [tall(K.IN_WINDOW, 3), tall(K.IN_WINDOW, 6), tall(K.IN_WINDOW, 9)] },
  home: { ...colors("home"), props: [tall(K.IN_BED, 2), row([K.IN_ARMCHAIR], 6), plant(14)] },
  townhall: { ...colors("townhall"), props: [row(K.IN_RUG.slice(0, 3), 6, 5), row(K.IN_RUG.slice(3), 6, 6), row([K.IN_CANDLE], 3), row([K.IN_CANDLE], 12)] },
};
export const DEFAULT_THEME: RoomTheme = { floor: 0x8a7a66, wall: 0xd8ccb8, props: [plant(2), plant(13)] };
export const OFFICE_THEME: RoomTheme = {
  ...DEFAULT_THEME,
  props: [
    row([K.IN_SAFE], 1, 2, { name: "Két token", action: "safe" }),
    row([K.IN_CABINET], 2, 2, { name: "Tủ hồ sơ", action: "cabinet" }),
    row([K.IN_PHONE], 3, 2, { name: "Điện thoại", action: "phone" }),
    row(K.IN_MAP, 5, 2, { name: "Bản đồ", action: "map" }),
    row(K.IN_BOOKSHELF, 8, 2, { name: "Kệ sách", action: "shelf" }),
    row(K.IN_WHITEBOARD, 12),
    plant(15),
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

export function deskSpots(n: number): Pt[] {
  const out: Pt[] = [];
  for (const y of [5, 7, 9]) for (const x of [2, 5, 10, 13]) out.push({ x, y });
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
