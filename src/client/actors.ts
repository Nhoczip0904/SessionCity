import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from "pixi.js";
import type { District, Employee, Session, State } from "../shared/types.js";
import { TILE, type buildCity } from "./city.js";
import { findPath, type Pt } from "./path.js";

type City = ReturnType<typeof buildCity>;
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

interface Actor {
  c: Container;
  label: Text;
  badge?: Text;
  tx: number; ty: number; // tile position (float while walking)
  path: Pt[];
  target?: Pt;
}

export class Actors {
  private mayors = new Map<string, Actor>();
  private staff = new Map<string, Actor>();
  private slots = new Map<string, number>();
  private more = new Map<string, Text>();
  private textures = new Map<string, Texture>();
  private clock = 0;

  constructor(private city: City, private layer: Container, private bake: (g: Graphics) => Texture) {
    layer.sortableChildren = true;
  }

  private tex(color: number, small: boolean): Texture {
    const k = `${color}|${small}`;
    let t = this.textures.get(k);
    if (!t) this.textures.set(k, (t = this.bake(figure(color, small))));
    return t;
  }

  private make(at: Pt, tex: Texture, labelText: string, hoverLabel: boolean): Actor {
    const c = new Container();
    const spr = new Sprite(tex);
    spr.anchor.set(0.5, 1);
    const label = new Text({ text: labelText, ...LIVE_TEXT });
    label.anchor.set(0.5, 1);
    label.y = -spr.height - 1;
    c.addChild(spr, label);
    if (hoverLabel) {
      label.visible = false;
      c.eventMode = "static";
      c.hitArea = new Rectangle(-4, -10, 8, 11);
      c.on("pointerover", () => { label.visible = true; c.zIndex = 1e6; });
      c.on("pointerout", () => (label.visible = false));
    }
    this.layer.addChild(c);
    return { c, label, tx: at.x, ty: at.y, path: [] };
  }

  private goTo(a: Actor, to: Pt) {
    if (a.target && a.target.x === to.x && a.target.y === to.y) return;
    a.target = to;
    a.path = findPath(this.city.walkable, { x: Math.round(a.tx), y: Math.round(a.ty) }, to);
  }

  private drop(map: Map<string, Actor>, keep: Set<string>) {
    for (const [id, a] of map) if (!keep.has(id)) { a.c.destroy({ children: true }); map.delete(id); }
  }

  private door(d: District): Pt {
    return this.city.doors[d] ?? this.city.doors.townhall;
  }

  sync(state: State): void {
    const live = new Set(state.sessions.map((s) => s.id));
    this.drop(this.mayors, live);
    for (const id of this.slots.keys()) if (!live.has(id)) this.slots.delete(id);
    for (const [id, t] of this.more) if (!live.has(id)) { t.destroy(); this.more.delete(id); }

    const byId = new Map<string, Session>();
    for (const s of state.sessions) {
      byId.set(s.id, s);
      let slot = this.slots.get(s.id);
      if (slot === undefined) {
        const used = new Set(this.slots.values());
        for (slot = 0; used.has(slot); slot++);
        this.slots.set(s.id, slot);
      }
      const hq = this.city.hqDoors[slot % this.city.hqDoors.length];
      let m = this.mayors.get(s.id);
      if (!m) this.mayors.set(s.id, (m = this.make(hq, this.tex(PALETTE[slot % PALETTE.length], false), "", false)));
      m.label.text = s.project.length > 14 ? s.project.slice(0, 13) + "…" : s.project;
      const badge = s.status === "waiting" ? "!" : s.status === "idle" ? "z" : "";
      if (badge && !m.badge) {
        m.badge = new Text({ text: badge, ...LIVE_TEXT, style: { ...LIVE_TEXT.style, fontSize: 9, fontWeight: "bold" } });
        m.badge.anchor.set(0.5, 1);
        m.badge.y = m.label.y - 8;
        m.c.addChild(m.badge);
      }
      if (m.badge) {
        m.badge.text = badge;
        m.badge.style.fill = badge === "!" ? 0xffd23f : 0x9ad0ff;
        m.badge.visible = badge !== "";
      }
      this.goTo(m, this.door(s.district));
    }

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
      const color = shade(PALETTE[slot % PALETTE.length], 0.45);
      for (const e of list.slice(0, MAX_EMPLOYEES)) {
        shown.add(e.id);
        let a = this.staff.get(e.id);
        if (!a) this.staff.set(e.id, (a = this.make(hq, this.tex(color, true), e.type, true)));
        this.goTo(a, this.door(e.district));
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

  update(dtMs: number): void {
    this.clock += dtMs;
    const stacks = new Map<number, number>(); // tile key -> actors already standing there
    for (const a of [...this.mayors.values(), ...this.staff.values()]) {
      let step = dtMs * SPEED;
      while (step > 0 && a.path.length) {
        const n = a.path[0], dx = n.x - a.tx, dy = n.y - a.ty, d = Math.abs(dx) + Math.abs(dy);
        if (d <= step) { a.tx = n.x; a.ty = n.y; a.path.shift(); step -= d; }
        else { a.tx += (dx / d) * step; a.ty += (dy / d) * step; step = 0; }
      }
      let ox = 0, oy = 0, bob = 0;
      if (a.path.length) bob = Math.floor(this.clock / 125) % 2;
      else {
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
