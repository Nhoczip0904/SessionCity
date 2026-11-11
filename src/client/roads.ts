import type { Pt } from "./path.js";

export interface RoadGraph { nodes: Pt[]; adj: number[][] }
/** `d` = tiles travelled on the edge from -> to; `speed` = tiles/ms. */
export interface CarState { from: number; to: number; d: number; speed: number }
type Rand = () => number;

/** The second index of each 2-tile road: [2,3,15,16] -> [3,16]. */
export const centreLines = (pairs: number[]): number[] => pairs.filter((_, i) => i % 2 === 1);

/** One node per (x, y) crossing; edges join neighbours along a row/column. xs/ys must be ascending. */
export function roadGraph(xs: number[], ys: number[]): RoadGraph {
  const nodes: Pt[] = [], adj: number[][] = [];
  ys.forEach((y) => xs.forEach((x) => nodes.push({ x, y })));
  const w = xs.length;
  nodes.forEach((_, i) => {
    const cx = i % w, cy = Math.floor(i / w), nb: number[] = [];
    if (cy > 0) nb.push(i - w);
    if (cx > 0) nb.push(i - 1);
    if (cx < w - 1) nb.push(i + 1);
    if (cy < ys.length - 1) nb.push(i + w);
    adj.push(nb);
  });
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
