import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from "pixi.js";
import type { District, Employee, Session, State } from "../shared/types.js";
import type { Place } from "./scene.js";
import { TILE, type buildCity } from "./city.js";
import { flyPaper, handoffs } from "./handoff.js";
import { findPath, type Pt } from "./path.js";
import { randomRoadTile, wanderTarget } from "./roads.js";
import { nearestHit } from "./rock.js";
import * as K from "./tiles.js";
import type { Outfit, Sheets } from "./tiles.js";

type City = ReturnType<typeof buildCity>;
export type PickKind = "session" | "employee";
const SPEED = 6 / 1000; // tiles per ms
const MAX_EMPLOYEES = 8;
const DOWN_MS = 1500;
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
export const restTarget = (home: Pt, wander: boolean, walkable: boolean[][], rand: Rand, taken: (p: Pt) => boolean = () => false): Pt =>
  wander ? wanderTarget(walkable, home, 3, rand, taken) : home;

/** Sideways offsets (px) people keep while walking, so two on the same path walk side by side. */
const LANES = [-4, 4, -2, 2, 0];

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
  lane: number; // px to the right of the walking direction
  down?: number; // ms left lying on the ground after a rock hit
  ouch?: Text;
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
  private seenStaff: Map<string, boolean> | null = null;
  private made = 0;

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
      // empty houses are dimmed; a lived-in one carries its project's name on a plate
      const dim = new Graphics().rect(r.x, r.y, r.w, r.h).fill({ color: 0x000000, alpha: 0.45 });
      const plate = new Container();
      const name = new Text({ text: "", ...LIVE_TEXT, style: { ...LIVE_TEXT.style, fontSize: 6 } });
      name.anchor.set(0.5);
      plate.addChild(new Graphics(), name);
      plate.position.set(r.x + r.w / 2, r.y + r.h / 2);
      plate.visible = false;
      h.addChild(dim, plate);
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
      if (this.sheets) return this.figure(0, K.OUTFIT_CITIZEN, true, this.citizens.length + 3);
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
  /** An anime girl: long tinted hair, big eyes, blush and a skirt over the outfit's shirt colour; `look` picks hair and skirt. */
  private figure(slot: number, outfit: Outfit, small: boolean, look = slot): Container {
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
    const add = (f: K.Frame, tint?: number) => {
      const spr = new Sprite(s.char(f[0], f[1]));
      spr.position.set(-8, -16);
      if (tint !== undefined) spr.tint = tint;
      fig.addChild(spr);
    };
    add(K.CHAR_BODY); add(K.PANTS); add(K.SHOES); add(shirt);
    // sprite pixels: head x 4–11 rows 2–6 (eyes on row 5), pants rows 13–15
    const face = new Graphics();
    const px = (x: number, y: number, w: number, h: number, c: number, a = 1) => face.rect(x - 8, y - 16, w, h).fill({ color: c, alpha: a });
    px(3, 12, 10, 1, K.SKIRTS[look % K.SKIRTS.length]).rect(-6, -3, 12, 2).fill(K.SKIRTS[look % K.SKIRTS.length]); // skirt over the pants
    px(5, 4, 2, 2, 0x2a3a8a); px(9, 4, 2, 2, 0x2a3a8a); // big eyes
    px(5, 4, 1, 1, 0xffffff); px(9, 4, 1, 1, 0xffffff); // shine
    px(5, 6, 1, 1, 0xff8aa0, 0.8); px(10, 6, 1, 1, 0xff8aa0, 0.8); // blush
    fig.addChild(face);
    add(K.LONG_HAIR, K.ANIME_HAIR[look % K.ANIME_HAIR.length]);
    if (outfit.hat) add(outfit.hat);
    if (outfit.item) add(outfit.item);
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
    return { c, fig: c, look: "", label, tx: at.x, ty: at.y, path: [], wander: false, wait: 0, lane: LANES[this.made++ % LANES.length] };
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
    this.hqHits.forEach((h, i) => {
      const s = byId.get(this.hqOwner[i] ?? "");
      h.eventMode = s ? "static" : "none";
      const [dim, plate] = h.children as [Graphics, Container];
      dim.visible = !s;
      plate.visible = !!s;
      if (!s) return;
      const [bg, name] = plate.children as [Graphics, Text];
      const text = s.project.length > 7 ? s.project.slice(0, 6) + "…" : s.project;
      if (name.text === text) return;
      name.text = text;
      const w = Math.min(name.width + 4, 30);
      bg.clear().roundRect(-w / 2, -5, w, 10, 2).fill(0x2a2a3a).stroke({ color: 0xd8c08a, width: 1 });
    });

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
        const houseTop = hq.y - 4; // every 2×4 HQ house sits right above its door
        t.position.set(hq.x * TILE + TILE, houseTop * TILE + 2 * TILE);
        t.zIndex = 1e5;
        this.layer.addChild(t);
        this.more.set(s.id, t);
      }
      if (t) { t.text = `+${extra}`; t.visible = extra > 0; }
    }
    // paper from the mayor to a new employee; the report flies back when the employee is done
    const now = state.employees.filter((e) => byId.has(e.sessionId)).map((e) => ({ id: e.id, done: e.status === "done", boss: e.sessionId }));
    const px = (a: Actor, dy: number): Pt => ({ x: a.tx * TILE + 8, y: a.ty * TILE + 14 - dy });
    if (this.opts.motion) for (const h of handoffs(this.seenStaff, now)) {
      const boss = this.mayors.get(now.find((e) => e.id === h.id)!.boss), worker = this.staff.get(h.id);
      if (!boss || !worker) continue; // employee beyond the per-session cap has no figure
      const [from, to] = h.kind === "assign" ? [px(boss, 14), px(worker, 8)] : [px(worker, 8), px(boss, 14)];
      flyPaper(this.layer, from, to, h.kind);
    }
    this.seenStaff = new Map(now.map((e) => [e.id, e.done]));
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
    // never settle on a tile someone else stands on or is heading to
    const busy = new Set<string>();
    for (const o of [...this.mayors.values(), ...this.staff.values(), ...this.citizens]) {
      if (o === a) continue;
      const end = o.path[o.path.length - 1] ?? { x: Math.round(o.tx), y: Math.round(o.ty) };
      busy.add(`${end.x},${end.y}`);
    }
    const taken = (p: Pt) => busy.has(`${p.x},${p.y}`);
    const to = a.citizen ? randomRoadTile(this.city.walkable, this.opts.rand, taken) : restTarget(a.home!, true, this.city.walkable, this.opts.rand, taken);
    this.walk(a, to);
    a.wait = 1000 + 3000 * this.opts.rand();
  }

  /** A rock landed at (x, y) in the layer: whoever it hits falls over, says "Ối!" and gets up again. */
  hit(at: Pt): boolean {
    const all = [...this.mayors.values(), ...this.staff.values(), ...this.citizens];
    const a = all[nearestHit(all.map((x) => ({ x: x.c.x, y: x.c.y })), at)];
    if (!a) return false;
    a.down = DOWN_MS;
    a.fig.rotation = (a.fig.scale.x < 0 ? -1 : 1) * Math.PI / 2;
    if (!a.ouch) {
      a.ouch = new Text({ text: "Ối!", ...LIVE_TEXT, style: { ...LIVE_TEXT.style, fontSize: 8, fontWeight: "bold", fill: 0xffd23f } });
      a.ouch.anchor.set(0.5, 1);
      a.ouch.y = -18;
      a.c.addChild(a.ouch);
    }
    a.ouch.visible = true;
    return true;
  }

  update(dtMs: number): void {
    this.clock += dtMs;
    const stacks = new Map<number, number>(); // tile key -> actors already standing there
    for (const a of [...this.mayors.values(), ...this.staff.values(), ...this.citizens]) {
      if (a.down !== undefined) {
        a.down -= dtMs;
        if (a.down > 0) continue; // lying on the ground: no walking
        a.down = undefined;
        a.fig.rotation = 0;
        if (a.ouch) a.ouch.visible = false;
      }
      let step = dtMs * SPEED, hx = 0, hy = 0;
      while (step > 0 && a.path.length) {
        const n = a.path[0], dx = n.x - a.tx, dy = n.y - a.ty, d = Math.abs(dx) + Math.abs(dy);
        if (dx) a.fig.scale.x = dx < 0 ? -1 : 1;
        if (d) { hx = Math.sign(dx); hy = Math.sign(dy); }
        if (d <= step) { a.tx = n.x; a.ty = n.y; a.path.shift(); step -= d; }
        else { a.tx += (dx / d) * step; a.ty += (dy / d) * step; step = 0; }
      }
      if (!a.path.length) this.rest(a, dtMs);
      let ox = 0, oy = 0, bob = 0;
      if (a.path.length) {
        bob = Math.floor(this.clock / 125) % 2;
        ox = -hy * a.lane; oy = hx * a.lane; // keep to own side of the path
      } else {
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
