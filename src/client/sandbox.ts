// Sandbox: objects the player drops on the map. They sit on an overlay layer; tiles and roads are never edited. The list lives in localStorage.
import { Container, Sprite } from "pixi.js";
import * as K from "./tiles.js";
import type { Sheets } from "./tiles.js";
import { TILE } from "./city.js";

export type PropKind = "tree" | "lamp" | "bench";
export interface Prop { kind: PropKind; x: number; y: number }
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): unknown };

export const SANDBOX_KEY = "backendcity.sandbox";
export const MAX_PROPS = 300;
const KINDS: PropKind[] = ["tree", "lamp", "bench"];
// a tall prop is two tiles: the top one sits above the point
const TILES: Record<PropKind, [top: number | null, bottom: number]> = { tree: [K.TREE_TOP, K.TREE_BOTTOM], lamp: [K.LAMP_TOP, K.LAMP_BOTTOM], bench: [null, K.BENCH] };

export function readProps(s: Store): Prop[] {
  try {
    const raw: unknown = JSON.parse(s.getItem(SANDBOX_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is Prop => !!p && KINDS.includes(p.kind) && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ kind: p.kind, x: p.x, y: p.y }))
      .slice(0, MAX_PROPS);
  } catch {
    return [];
  }
}

export function mountProps(parent: Container, sheets: Sheets | null, s: Store) {
  let props = readProps(s);
  const root = new Container();
  root.eventMode = "none";
  root.sortableChildren = true;
  parent.addChild(root);
  const nodes = new Map<Prop, Container>();
  const save = () => {
    try {
      s.setItem(SANDBOX_KEY, JSON.stringify(props));
    } catch {
      // storage full or blocked: the props stay until reload
    }
  };
  const draw = (p: Prop) => {
    const c = new Container();
    const [top, bottom] = TILES[p.kind];
    for (const [i, t] of [top, bottom].entries()) {
      if (t === null) continue;
      const sp = new Sprite(sheets ? sheets.city(t) : undefined);
      sp.position.set(-TILE / 2, (i - 1) * TILE);
      c.addChild(sp);
    }
    c.position.set(p.x, p.y);
    c.zIndex = p.y;
    root.addChild(c);
    nodes.set(p, c);
  };
  props.forEach(draw);
  return {
    add(kind: PropKind, at: { x: number; y: number }): boolean {
      if (props.length >= MAX_PROPS) return false;
      const p = { kind, x: Math.round(at.x), y: Math.round(at.y) };
      props.push(p);
      draw(p);
      save();
      return true;
    },
    /** Remove every prop within `r` px of the point. */
    erase(at: { x: number; y: number }, r: number): boolean {
      const gone = props.filter((p) => Math.hypot(p.x - at.x, p.y - at.y) <= r);
      if (!gone.length) return false;
      for (const p of gone) {
        nodes.get(p)?.destroy({ children: true });
        nodes.delete(p);
      }
      props = props.filter((p) => !gone.includes(p));
      save();
      return true;
    },
  };
}
