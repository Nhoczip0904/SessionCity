import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from "pixi.js";
import type { District, Employee, Session, State } from "../shared/types.js";
import type { Place } from "./scene.js";
import { TILE, type buildCity } from "./city.js";
import { findPath, type Pt } from "./path.js";
import { randomRoadTile, wanderTarget } from "./roads.js";
import * as K from "./tiles.js";
import type { Outfit, Sheets } from "./tiles.js";

type City = ReturnType<typeof buildCity>;
export type PickKind = "session" | "employee";
const SPEED = 6 / 1000; // tiles per ms
const MAX_EMPLOYEES = 8;
const PALETTE = [0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe, 0x008080, 0xe6beff];
const LIVE_TEXT = {
  style: { fontFamily: 'Consolas, "DejaVu Sans Mono", "Courier New", monospace', fontSize: 7, fill: 0xffffff, stroke: { color: 0x111111, width: 2 } },
  resolution: 4,
  textureStyle: { scaleMode: "linear" as const },
};

/** k > 0 mixes toward white, k < 0 scales toward black. */
const shade = (c: number, k: number) =>
  [16, 8, 0].reduce((out, s) => {
    const v = (c >> s) & 255;
    return out | (Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)) << s);
  }, 0);

/** 8×12 mayor (top hat) or 6×9 employee, drawn pixel by pixel. */
function figure(body: number, small: boolean): Graphics {
  const g = new Graphics();
  const px = (x: number, y: number, w: number, h: number, c: number, a = 1) => g.rect(x, y, w, h).fill({ color: c, alpha: a });
  const dark = shade(body, -0.4);
  if (small) {
    px(1, 8, 4, 1, 0x000000, 0.3);
    px(1, 0, 4, 3, 0xf1c27d);
    px(2, 1, 1, 1, 0x222222).rect(4, 1, 1, 1).fill(0x222222);
    px(0, 3, 6, 4, body);
    px(1, 7, 1, 1, 0x333333).rect(4, 7, 1, 1).fill(0x333333);
    return g;
  }
  px(1, 12, 6, 1, 0x000000, 0.3);
  px(2, 0, 4, 2, 0x222222);
  px(1, 2, 6, 1, 0x222222);
  px(2, 3, 4, 3, 0xf1c27d);
  px(3, 4, 1, 1, 0x222222).rect(5, 4, 1, 1).fill(0x222222);
  px(1, 6, 6, 4, body);
  px(0, 6, 1, 3, dark).rect(7, 6, 1, 3).fill(dark);
  px(3, 6, 2, 1, 0xffffff);
  px(2, 10, 2, 2, 0x333333).rect(4, 10, 2, 2).fill(0x333333);
  return g;
}

type Rand = () => number;
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

/** Where an idle actor settles: its door, or a random walkable tile within 3 of it when wandering. */
export const restTarget = (home: Pt, wander: boolean, walkable: boolean[][], rand: Rand): Pt =>
  wander ? wanderTarget(walkable, home, 3, rand) : home;

const outfitFor = (type: string): Outfit =>
  type === "Explore" ? K.OUTFIT_EXPLORE
  : type === "Plan" ? K.OUTFIT_PLAN
  : type === "general-purpose" ? K.OUTFIT_GENERAL
  : /review/i.test(type) ? K.OUTFIT_REVIEW
  : /test/i.test(type) ? K.OUTFIT_TEST
  : K.OUTFIT_OTHER;

interface Actor {
  c: Container;
  fig: Container; // the figure itself; flipped to face the walking direction
  look: string; // what the figure was built from, to rebuild it when that changes
  label: Text;
  badge?: Text;
  tx: number; ty: number; // tile position (float while walking)
  path: Pt[];
  home?: Pt;
  wander: boolean;
  wait: number; // ms until the next wander step
  citizen?: boolean;
}

export class Actors {
  private mayors = new Map<string, Actor>();
  private staff = new Map<string, Actor>();
  private slots = new Map<string, number>();
  private more = new Map<string, Text>();
  private textures = new Map<string, Texture>();
  private hqOwner: (string | undefined)[] = [];
  private hqHits: Container[];
  private plotHits: Container[];
  private lastStaff = new Map<string, { type: string; sessionId: string }>();
  private citizens: Actor[] = [];
  private clock = 0;

  constructor(
    private city: City,
    private layer: Container,
    private bake: (g: Graphics) => Texture,
    private sheets: Sheets | null,
    private onPick: (kind: PickKind, id: string) => void,
    private onEnter: (p: Place) => void,
    private opts: { motion: boolean; rand: Rand } = { motion: !matchMedia("(prefers-reduced-motion: reduce)").matches, rand: Math.random },
  ) {
    layer.sortableChildren = true;
    // HQ houses: clicking one enters the office of the session living there
    this.hqHits = city.hqPlots.map((r, i) => {
      const h = new Container();
      h.hitArea = new Rectangle(r.x, r.y, r.w, r.h);
      h.cursor = "pointer";
      h.eventMode = "none";
      h.zIndex = -1;
      h.on("pointertap", () => { const id = this.hqOwner[i]; if (id) this.onEnter({ kind: "office", sessionId: id }); });
      layer.addChild(h);
      return h;
    });
    // district buildings: clicking one enters its room
    this.plotHits = city.plots.map((p) => {
      const h = new Container();
      h.hitArea = new Rectangle(p.px.x, p.px.y, p.px.w, p.px.h);
      h.cursor = "pointer";
      h.eventMode = "static";
      h.zIndex = -1;
      h.on("pointertap", () => this.onEnter({ kind: "room", district: p.id }));
      layer.addChild(h);
      return h;
    });
    if (opts.motion) for (let i = 0; i < 5; i++) this.citizens.push(this.makeCitizen());
  }

  private makeCitizen(): Actor {
    const a = this.make(randomRoadTile(this.city.walkable, this.opts.rand), "", () => {}, false);
    a.c.eventMode = "none";
    a.label.visible = false;
    a.citizen = true;
    a.wander = true;
    this.dress(a, "citizen", () => {
      if (this.sheets) return this.figure(0, K.OUTFIT_CITIZEN, true);
      const spr = new Sprite(this.tex(0x999999, true));
      spr.anchor.set(0.5, 1);
      return spr;
    });
    return a;
  }

  private tex(color: number, small: boolean): Texture {
    const k = `${color}|${small}`;
    let t = this.textures.get(k);
    if (!t) this.textures.set(k, (t = this.bake(figure(color, small))));
    return t;
  }

  /** Part 1 figure without sheets, else layered Kenney sprites (16×16, feet at the origin). */
  private figure(slot: number, outfit: Outfit, small: boolean): Container {
    if (!this.sheets) {
      const base = PALETTE[slot % PALETTE.length];
      const spr = new Sprite(this.tex(small ? shade(base, 0.45) : base, small));
      spr.anchor.set(0.5, 1);
      return spr;
    }
    const s = this.sheets;
    const [bc, br] = K.SHIRT_COLORS[slot % K.SHIRT_COLORS.length];
    const shirt: K.Frame = outfit.own ? [bc + outfit.shirt[0], br + outfit.shirt[1]] : outfit.shirt;
    const fig = new Container();
    for (const f of [K.CHAR_BODY, K.PANTS, K.SHOES, shirt, outfit.hair, outfit.hat, outfit.item]) {
      if (!f) continue;
      const spr = new Sprite(s.char(f[0], f[1]));
      spr.position.set(-8, -16);
      fig.addChild(spr);
    }
    return fig;
  }

  private make(at: Pt, labelText: string, pick: () => void, hoverLabel: boolean): Actor {
    const c = new Container();
    const label = new Text({ text: labelText, ...LIVE_TEXT });
    label.anchor.set(0.5, 1);
    c.addChild(label);
    c.eventMode = "static";
    c.cursor = "pointer";
    c.on("pointertap", pick);
    if (hoverLabel) {
      label.visible = false;
      c.on("pointerover", () => { label.visible = true; c.zIndex = 1e6; });
      c.on("pointerout", () => (label.visible = false));
    }
    this.layer.addChild(c);
    return { c, fig: c, look: "", label, tx: at.x, ty: at.y, path: [], wander: false, wait: 0 };
  }

  /** (Re)builds the figure when its look changes, e.g. an employee's type gets refined. */
  private dress(a: Actor, look: string, build: () => Container) {
    if (a.look === look) return;
    if (a.fig !== a.c) a.fig.destroy({ children: true });
    const fig = build();
    a.c.addChildAt(fig, 0);
    a.fig = fig;
    a.look = look;
    const h = fig.height, w = fig.width;
    a.label.y = -h - 1;
    if (a.badge) a.badge.y = a.label.y - 8;
    a.c.hitArea = new Rectangle(-w / 2, -h, w, h);
  }

  private walk(a: Actor, to: Pt) {
    a.path = findPath(this.city.walkable, { x: Math.round(a.tx), y: Math.round(a.ty) }, to);
  }

  /** A new district door sends the actor there at once; `wander` only decides what it does once idle. */
  private setHome(a: Actor, home: Pt, wander: boolean) {
    a.wander = this.opts.motion && wander;
    if (a.home && same(a.home, home)) return;
    a.home = home;
    a.wait = 0;
    this.walk(a, home);
  }

  private drop(map: Map<string, Actor>, keep: Set<string>) {
    for (const [id, a] of map) if (!keep.has(id)) { a.c.destroy({ children: true }); map.delete(id); }
  }

  private door(d: District): Pt {
    return this.city.doors[d] ?? this.city.doors.townhall;
  }

  /** The same figure as the street actor (fresh instance, feet at the origin), or null when unknown. */
  portrait(kind: PickKind, id: string): Container | null {
    if (kind === "session") {
      const slot = this.slots.get(id);
      return slot === undefined ? null : this.figure(slot, K.OUTFIT_MAYOR, false);
    }
    const e = this.lastStaff.get(id), slot = e && this.slots.get(e.sessionId);
    return e && slot !== undefined ? this.figure(slot, outfitFor(e.type), true) : null;
  }

  sync(state: State): void {
    this.lastStaff = new Map(state.employees.map((e) => [e.id, { type: e.type, sessionId: e.sessionId }]));
    const live = new Set(state.sessions.map((s) => s.id));
    this.drop(this.mayors, live);
    for (const id of this.slots.keys()) if (!live.has(id)) this.slots.delete(id);
    for (const [id, t] of this.more) if (!live.has(id)) { t.destroy(); this.more.delete(id); }

    const byId = new Map<string, Session>();
    this.hqOwner = [];
    for (const s of state.sessions) {
      byId.set(s.id, s);
      let slot = this.slots.get(s.id);
      if (slot === undefined) {
        const used = new Set(this.slots.values());
        for (slot = 0; used.has(slot); slot++);
        this.slots.set(s.id, slot);
      }
      const hqIdx = slot % this.city.hqDoors.length;
      this.hqOwner[hqIdx] ??= s.id;
      const hq = this.city.hqDoors[hqIdx];
      let m = this.mayors.get(s.id);
      if (!m) {
        const id = s.id, sl = slot;
        this.mayors.set(id, (m = this.make(hq, "", () => this.onPick("session", id), false)));
        this.dress(m, "mayor", () => this.figure(sl, K.OUTFIT_MAYOR, false));
      }
      m.label.text = s.project.length > 14 ? s.project.slice(0, 13) + "…" : s.project;
      const badge = s.status === "waiting" ? "!" : s.status === "idle" ? "z" : "";
      if (badge && !m.badge) {
        m.badge = new Text({ text: "", ...LIVE_TEXT, style: { ...LIVE_TEXT.style, fontSize: 9, fontWeight: "bold" } });
        m.badge.anchor.set(0.5, 1);
        m.badge.y = m.label.y - 8;
        m.c.addChild(m.badge);
      }
      if (m.badge && m.badge.text !== badge) {
        m.badge.text = badge;
        if (badge) m.badge.style.fill = badge === "!" ? 0xffd23f : 0x9ad0ff;
        m.badge.visible = badge !== "";
      }
      this.setHome(m, this.door(s.district), s.status === "working");
    }
    this.hqHits.forEach((h, i) => (h.eventMode = this.hqOwner[i] ? "static" : "none"));

    // employees: working ones only, newest first, capped per session
    const groups = new Map<string, Employee[]>();
    for (const e of state.employees) {
      if (e.status !== "working" || !byId.has(e.sessionId)) continue;
      const list = groups.get(e.sessionId) ?? [];
      list.push(e);
      groups.set(e.sessionId, list);
    }
    const shown = new Set<string>();
    for (const s of state.sessions) {
      const list = (groups.get(s.id) ?? []).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const slot = this.slots.get(s.id)!;
      const hq = this.city.hqDoors[slot % this.city.hqDoors.length];
      for (const e of list.slice(0, MAX_EMPLOYEES)) {
        shown.add(e.id);
        let a = this.staff.get(e.id);
        if (!a) {
          const id = e.id;
          this.staff.set(id, (a = this.make(hq, e.type, () => this.onPick("employee", id), true)));
        }
        a.label.text = e.type;
        const outfit = outfitFor(e.type);
        this.dress(a, this.sheets ? `${outfit.shirt}|${outfit.own}|${outfit.item}` : "staff", () => this.figure(slot, outfit, true));
        this.setHome(a, this.door(e.district), true);
      }
      const extra = list.length - MAX_EMPLOYEES;
      let t = this.more.get(s.id);
      if (extra > 0 && !t) {
        t = new Text({ text: "", ...LIVE_TEXT });
        t.anchor.set(0.5);
        // shortcut: assumes the 2×4 HQ house sits right below an up-facing door or right above a down-facing one
        const houseTop = this.city.walkable[hq.y + 1]?.[hq.x] ? hq.y - 4 : hq.y + 1;
        t.position.set(hq.x * TILE + TILE, houseTop * TILE + 2 * TILE);
        t.zIndex = 1e5;
        this.layer.addChild(t);
        this.more.set(s.id, t);
      }
      if (t) { t.text = `+${extra}`; t.visible = extra > 0; }
    }
    this.drop(this.staff, shown);
  }

  /** An actor with no path left: go home, or (wandering) pick a new spot after a pause. */
  private rest(a: Actor, dtMs: number) {
    const at = { x: Math.round(a.tx), y: Math.round(a.ty) };
    if (!a.wander) {
      if (a.home && !same(at, a.home)) this.walk(a, a.home);
      return;
    }
    a.wait -= dtMs;
    if (a.wait > 0) return;
    const to = a.citizen ? randomRoadTile(this.city.walkable, this.opts.rand) : restTarget(a.home!, true, this.city.walkable, this.opts.rand);
    this.walk(a, to);
    a.wait = 1000 + 3000 * this.opts.rand();
  }

  update(dtMs: number): void {
    this.clock += dtMs;
    const stacks = new Map<number, number>(); // tile key -> actors already standing there
    for (const a of [...this.mayors.values(), ...this.staff.values(), ...this.citizens]) {
      let step = dtMs * SPEED;
      while (step > 0 && a.path.length) {
        const n = a.path[0], dx = n.x - a.tx, dy = n.y - a.ty, d = Math.abs(dx) + Math.abs(dy);
        if (dx) a.fig.scale.x = dx < 0 ? -1 : 1;
        if (d <= step) { a.tx = n.x; a.ty = n.y; a.path.shift(); step -= d; }
        else { a.tx += (dx / d) * step; a.ty += (dy / d) * step; step = 0; }
      }
      if (!a.path.length) this.rest(a, dtMs);
      let ox = 0, oy = 0, bob = 0;
      if (a.path.length) bob = Math.floor(this.clock / 125) % 2;
      else if (!a.citizen) {
        // spread actors sharing a tile: rows of 3, stepping upward
        const k = a.ty * 1000 + a.tx, i = stacks.get(k) ?? 0;
        stacks.set(k, i + 1);
        ox = [0, -7, 7][i % 3];
        oy = -Math.floor(i / 3) * 6;
      }
      a.c.x = Math.round(a.tx * TILE + 8 + ox);
      a.c.y = Math.round(a.ty * TILE + 14 + oy - bob);
      if (a.c.zIndex !== 1e6 || !a.label.visible) a.c.zIndex = a.c.y;
    }
  }
}
