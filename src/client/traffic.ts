import { Container, Graphics, Sprite, Ticker } from "pixi.js";
import { ROADS, TILE } from "./city.js";
import { carPos, gapAhead, inLane, roadGraph, spawnCar, stepCar, type CarState, type RoadGraph } from "./roads.js";
import { CARS, CARS_DOWN, CARS_UP, type Sheets } from "./tiles.js";

const COUNT = 6;
const SCALE = 0.5; // half size, so two cars pass side by side on a 2-tile road
const MIN_GAP = 1.8; // tiles kept to the car in front (a car is 1.5 tiles long at this scale)
const MAX_WAIT = 2500; // ms; then drive on anyway, so a jam at a crossing always clears
const REACH = 10; // px from a car's middle that a rock still hits it
const RESPAWN = 4000; // ms before a blown-up car is replaced
const BOOM_MS = 900;

/** Fireball, smoke and flying debris at (x, y), then gone. */
export function boom(parent: Container, x: number, y: number, size = 1) {
  const g = new Graphics();
  g.label = "boom";
  g.eventMode = "none";
  g.position.set(x, y);
  g.scale.set(size);
  parent.addChild(g);
  const bits = Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * Math.PI * 2 + 0.3, v: 10 + (i % 3) * 5 }));
  let t = 0;
  const step = (tk: Ticker) => {
    t += tk.deltaMS;
    const p = Math.min(1, t / BOOM_MS);
    if (g.destroyed) return void Ticker.shared.remove(step);
    g.clear();
    for (let k = 0; k < 3; k++) g.circle((k - 1) * 4, -4 - p * 14 - k * 2, 3 + p * 6).fill({ color: 0x5a5a5a, alpha: 0.5 * (1 - p) });
    if (p < 0.6) {
      const q = p / 0.6;
      g.circle(0, 0, 4 + q * 12).fill({ color: 0xff6a20, alpha: 1 - q }).circle(0, 0, 2 + q * 7).fill({ color: 0xffe066, alpha: 1 - q });
    }
    for (const b of bits) g.rect(Math.cos(b.a) * b.v * p, Math.sin(b.a) * b.v * p + 20 * p * p, 1.5, 1.5).fill({ color: 0x333333, alpha: 1 - p });
    if (p >= 1) { Ticker.shared.remove(step); g.destroy(); }
  };
  Ticker.shared.add(step);
}

interface Car { root: Container; side: Container; up: Container; down: Container }

/** Tiles laid out `w` wide, pivoted on their centre. */
function block(sheets: Sheets, tiles: number[], w: number): Container {
  const c = new Container();
  tiles.forEach((i, k) => {
    const s = new Sprite(sheets.city(i));
    s.position.set((k % w) * TILE, Math.floor(k / w) * TILE);
    c.addChild(s);
  });
  c.pivot.set((w * TILE) / 2, TILE);
  return c;
}

/** Decorative cars wandering randomly over the road grid (no data, no input). */
export class Traffic {
  private cars: { car: Car; state: CarState; waited: number; wreck: number }[] = []; // wreck: ms until a blown-up car is replaced
  private graph: RoadGraph;

  constructor(private layer: Container, sheets: Sheets | null, private rand: () => number = Math.random) {
    layer.eventMode = "none";
    // centre lines of the 2-tile roads; cars drive in the right-hand lane beside them
    this.graph = roadGraph(ROADS);
    if (!sheets || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < COUNT; i++) {
      const k = i % CARS.length;
      const car: Car = {
        root: new Container(),
        side: block(sheets, CARS[k], 3),
        up: block(sheets, CARS_UP[k], 2),
        down: block(sheets, CARS_DOWN[k], 2),
      };
      car.root.addChild(car.side, car.up, car.down);
      car.root.scale.set(SCALE);
      layer.addChild(car.root);
      this.cars.push({ car, state: spawnCar(this.graph, this.rand), waited: 0, wreck: 0 });
    }
    this.update(0);
  }

  /** A rock landed at (x, y) px: the nearest car within reach blows up and is replaced a few seconds later. */
  hit(at: { x: number; y: number }): boolean {
    let best: (typeof this.cars)[number] | null = null, bestD = REACH;
    for (const c of this.cars) {
      const d = Math.hypot(c.car.root.x - at.x, c.car.root.y - at.y);
      if (!c.wreck && d <= bestD) { best = c; bestD = d; }
    }
    if (!best) return false;
    best.wreck = RESPAWN;
    best.car.root.visible = false;
    boom(this.layer, best.car.root.x, best.car.root.y);
    return true;
  }

  update(dtMs: number): void {
    for (const c of this.cars) {
      if (!c.wreck) continue;
      c.wreck = Math.max(0, c.wreck - dtMs);
      if (!c.wreck) { c.state = spawnCar(this.graph, this.rand); c.waited = 0; c.car.root.visible = true; }
    }
    // a wreck takes no road space
    const where = this.cars.map((c) => (c.wreck ? { x: -1e6, y: -1e6, dx: 0, dy: 0 } : inLane(carPos(this.graph, c.state))));
    this.cars.forEach((c, i) => {
      if (c.wreck) return;
      const others = where.filter((_, j) => j !== i);
      if (gapAhead(where[i], others) >= MIN_GAP || c.waited > MAX_WAIT) {
        stepCar(this.graph, c.state, dtMs, this.rand);
        c.waited = 0;
      } else c.waited += dtMs;
    });
    for (const { car, state, wreck } of this.cars) {
      if (wreck) continue;
      const { x, y, dx, dy } = inLane(carPos(this.graph, state));
      car.root.position.set(Math.round(x * TILE), Math.round(y * TILE));
      car.side.visible = dx !== 0;
      car.side.scale.x = dx > 0 ? -1 : 1; // the side view faces left
      car.up.visible = dy < 0;
      car.down.visible = dy > 0;
    }
  }
}
