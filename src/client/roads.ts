import type { Pt } from "./path.js";

export interface RoadGraph { nodes: Pt[]; adj: number[][] }
/** `d` = tiles travelled on the edge from -> to; `speed` = tiles/ms. */
export interface CarState { from: number; to: number; d: number; speed: number }
type Rand = () => number;

/** A 2-tile-wide road, in tiles: horizontal when w > h. */
export interface Road { x: number; y: number; w: number; h: number }
export const onRoad = (r: Road, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/**
 * Nodes at every crossing, T-junction and dead end of the roads' centre lines; edges join
 * neighbouring nodes along a road. A road's centre line is its second row/column.
 */
export function roadGraph(roads: Road[]): RoadGraph {
  const nodes: Pt[] = [], adj: number[][] = [];
  const node = (x: number, y: number) => {
    let i = nodes.findIndex((n) => n.x === x && n.y === y);
    if (i < 0) { i = nodes.push({ x, y }) - 1; adj.push([]); }
    return i;
  };
  // centre line of each road: fixed coordinate c, running from a to b along the other axis
  const lines = roads.map((r) => (r.w > r.h ? { h: true, c: r.y + 1, a: r.x + 1, b: r.x + r.w - 1 } : { h: false, c: r.x + 1, a: r.y + 1, b: r.y + r.h - 1 }));
  for (const l of lines) {
    const at = new Set([l.a, l.b]);
    for (const o of lines) if (o.h !== l.h && o.c >= l.a && o.c <= l.b && l.c >= o.a && l.c <= o.b) at.add(o.c);
    const ids = [...at].sort((p, q) => p - q).map((t) => (l.h ? node(t, l.c) : node(l.c, t)));
    for (let k = 1; k < ids.length; k++) { adj[ids[k - 1]].push(ids[k]); adj[ids[k]].push(ids[k - 1]); }
  }
  return { nodes, adj };
}

const pick = <T>(a: T[], rand: Rand): T => a[Math.min(a.length - 1, Math.floor(rand() * a.length))];

export function nextNode(g: RoadGraph, at: number, from: number, rand: Rand): number {
  const opts = g.adj[at].filter((n) => n !== from);
  return opts.length ? pick(opts, rand) : from;
}

const edgeLen = (g: RoadGraph, c: CarState) =>
  Math.abs(g.nodes[c.to].x - g.nodes[c.from].x) + Math.abs(g.nodes[c.to].y - g.nodes[c.from].y);

export function spawnCar(g: RoadGraph, rand: Rand): CarState {
  const from = pick(g.nodes.map((_, i) => i), rand);
  const car: CarState = { from, to: pick(g.adj[from], rand), d: 0, speed: (2 + 2 * rand()) / 1000 };
  car.d = rand() * edgeLen(g, car);
  return car;
}

export function stepCar(g: RoadGraph, car: CarState, dtMs: number, rand: Rand): void {
  car.d += dtMs * car.speed;
  for (let len = edgeLen(g, car); car.d >= len; len = edgeLen(g, car)) {
    car.d -= len;
    const to = nextNode(g, car.to, car.from, rand);
    car.from = car.to;
    car.to = to;
  }
}

export function carPos(g: RoadGraph, car: CarState): { x: number; y: number; dx: number; dy: number } {
  const p = g.nodes[car.from], q = g.nodes[car.to];
  const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y);
  return { x: p.x + dx * car.d, y: p.y + dy * car.d, dx, dy };
}

/** Uniform over walkable, untaken tiles within Manhattan `radius` of `door`; `door` if none. */
export function wanderTarget(walkable: boolean[][], door: Pt, radius: number, rand: Rand, taken: (p: Pt) => boolean = () => false): Pt {
  const c: Pt[] = [];
  for (let y = door.y - radius; y <= door.y + radius; y++)
    for (let x = door.x - radius; x <= door.x + radius; x++)
      if (Math.abs(x - door.x) + Math.abs(y - door.y) <= radius && walkable[y]?.[x] && !taken({ x, y })) c.push({ x, y });
  return c.length ? pick(c, rand) : door;
}

/** The walkable tile closest to `p` (clamped onto the grid, then searched ring by ring); `p` itself when nothing is walkable. */
export function nearestWalkable(walkable: boolean[][], p: Pt): Pt {
  const h = walkable.length, w = walkable[0]?.length ?? 0;
  const q = { x: Math.min(Math.max(p.x, 0), w - 1), y: Math.min(Math.max(p.y, 0), h - 1) };
  for (let r = 0; r <= Math.max(h, w); r++) {
    let best: Pt | null = null, bd = Infinity;
    for (let y = q.y - r; y <= q.y + r; y++)
      for (let x = q.x - r; x <= q.x + r; x++) {
        if (Math.max(Math.abs(x - q.x), Math.abs(y - q.y)) !== r || !walkable[y]?.[x]) continue;
        const d = Math.hypot(x - q.x, y - q.y);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    if (best) return best;
  }
  return p;
}

export function randomRoadTile(walkable: boolean[][], rand: Rand, taken: (p: Pt) => boolean = () => false): Pt {
  const c: Pt[] = [];
  walkable.forEach((row, y) => row.forEach((ok, x) => ok && !taken({ x, y }) && c.push({ x, y })));
  return c.length ? pick(c, rand) : { x: 0, y: 0 };
}

/** Half a lane: cars keep to the right of the 2-tile road's centre line. */
export const LANE = 0.5;
type Heading = { x: number; y: number; dx: number; dy: number };

/** Position in the right-hand lane for a car on the centre line heading (dx, dy); screen y points down. */
export const inLane = (p: Heading): Heading => ({ ...p, x: p.x - p.dy * LANE, y: p.y + p.dx * LANE });

/** Distance in tiles to the nearest car straight ahead in the same lane (Infinity if none). */
export function gapAhead(me: Heading, others: { x: number; y: number }[]): number {
  let best = Infinity;
  for (const o of others) {
    const rx = o.x - me.x, ry = o.y - me.y;
    const along = rx * me.dx + ry * me.dy, side = Math.abs(rx * me.dy - ry * me.dx);
    if (along > 0.01 && side < 0.6 && along < best) best = along;
  }
  return best;
}
