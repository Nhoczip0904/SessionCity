export type Pt = { x: number; y: number };

/** 4-neighbour A* (Manhattan). Path excludes `from`, includes `to`; [] if unreachable or from == to. */
export function findPath(walkable: boolean[][], from: Pt, to: Pt): Pt[] {
  const rows = walkable.length;
  const cols = rows ? walkable[0].length : 0;
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && walkable[y][x];
  if ((from.x === to.x && from.y === to.y) || !ok(from.x, from.y) || !ok(to.x, to.y)) return [];

  const key = (x: number, y: number) => y * cols + x;
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const g = new Map<number, number>([[key(from.x, from.y), 0]]);
  const prev = new Map<number, number>();
  // shortcut: linear-scan open list, fine for a 48×32 grid; use a heap if maps grow large
  const open: { k: number; f: number }[] = [{ k: key(from.x, from.y), f: h(from.x, from.y) }];
  const goal = key(to.x, to.y);

  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const { k } = open.splice(best, 1)[0];
    if (k === goal) {
      const path: Pt[] = [];
      for (let c = k; prev.has(c); c = prev.get(c)!) path.push({ x: c % cols, y: Math.floor(c / cols) });
      return path.reverse();
    }
    const x = k % cols, y = Math.floor(k / cols), gk = g.get(k)! + 1;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!ok(nx, ny)) continue;
      const nk = key(nx, ny);
      if (gk >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, gk);
      prev.set(nk, k);
      open.push({ k: nk, f: gk + h(nx, ny) });
    }
  }
  return [];
}
