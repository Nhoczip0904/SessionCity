import { Container, Graphics, Sprite, Ticker } from "pixi.js";
import { ROADS, TILE } from "./city.js";
import { carPos, gapAhead, inLane, roadGraph, spawnCar, stepCar, type CarState, type RoadGraph } from "./roads.js";
import { animeFigure } from "./actors.js";
import { crossingClosed, holdAtGate } from "./forest.js";
import * as K from "./tiles.js";
import { CARS, CARS_DOWN, CARS_UP, type Sheets } from "./tiles.js";

const COUNT = 9; // some of them drive off into the forest and come back
const SCALE = 0.5; // half size, so two cars pass side by side on a 2-tile road
const MIN_GAP = 1.8; // tiles kept to the car in front (a car is 1.5 tiles long at this scale)
const MAX_WAIT = 2500; // ms; then drive on anyway, so a jam at a crossing always clears
const REACH = 10; // px from a car's middle that a rock still hits it
const RESPAWN = 4000; // ms before a blown-up car is replaced
const BOOM_MS = 900;
const MAX_CARS = 40; // sandbox ceiling, drawing cost grows with it
const BIKES = 4; // cyclists: same roads and lane as the cars, at half their speed

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

/** The citizens' anime sprite, seated: lifted onto the pedals and a touch smaller than a walker. */
function rider(sheets: Sheets, n: number, y: number): Container {
  const c = animeFigure(sheets, n, K.OUTFIT_CITIZEN, 50 + n * 7);
  c.position.y = y;
  c.scale.set(0.85);
  return c;
}

/** A cyclist seen from the side (feet on y = 0, facing left). */
function bikeSide(sheets: Sheets, n: number): Container {
  const g = new Graphics();
  g.circle(-5, -3.5, 3.5).stroke({ color: 0x222222, width: 1 }).circle(5, -3.5, 3.5).stroke({ color: 0x222222, width: 1 });
  g.moveTo(-5, -3.5).lineTo(-1, -7).lineTo(4, -7).lineTo(5, -3.5).moveTo(-1, -7).lineTo(1, -3.5).lineTo(-5, -3.5).stroke({ color: 0xc8c8c8, width: 1 });
  const c = new Container();
  c.addChild(g, rider(sheets, n, -4));
  return c;
}

/** A cyclist coming or going: one thin wheel under the rider. */
function bikeFront(sheets: Sheets, n: number): Container {
  const c = new Container();
  c.addChild(new Graphics().rect(-0.5, -6, 1, 6).fill(0x222222).rect(-3, -8, 6, 1).fill(0xc8c8c8), rider(sheets, n, -3));
  return c;
}

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
  private cars: { car: Car; state: CarState; waited: number; wreck: number; bike?: boolean }[] = []; // wreck: ms until a blown-up car is replaced
  private graph: RoadGraph;

  constructor(private layer: Container, private sheets: Sheets | null, private rand: () => number = Math.random) {
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
    for (let i = 0; i < BIKES; i++) {
      const car: Car = { root: new Container(), side: bikeSide(sheets, i), up: bikeFront(sheets, i), down: bikeFront(sheets, i) };
      car.root.addChild(car.side, car.up, car.down);
      layer.addChild(car.root);
      this.cars.push({ car, state: this.spawn(true), waited: 0, wreck: 0, bike: true });
    }
    this.update(0);
  }

  /** Sandbox: one more car on a random road, up to MAX_CARS in all. */
  add(): boolean {
    if (!this.sheets || this.cars.length >= MAX_CARS) return false;
    const k = this.cars.length % CARS.length;
    const car: Car = { root: new Container(), side: block(this.sheets, CARS[k], 3), up: block(this.sheets, CARS_UP[k], 2), down: block(this.sheets, CARS_DOWN[k], 2) };
    car.root.addChild(car.side, car.up, car.down);
    car.root.scale.set(SCALE);
    this.layer.addChild(car.root);
    this.cars.push({ car, state: spawnCar(this.graph, this.rand), waited: 0, wreck: 0 });
    return true;
  }

  private spawn(bike?: boolean): CarState {
    const s = spawnCar(this.graph, this.rand);
    if (bike) s.speed = (1.2 + 0.6 * this.rand()) / 1000;
    return s;
  }

  /** A rock landed at (x, y) px: the nearest car within reach blows up and is replaced a few seconds later. */
  hit(at: { x: number; y: number }, radius = 0): boolean {
    // radius > 0 (a bolt): every car inside it; else only the nearest one within reach
    let hits: (typeof this.cars)[number][] = [], bestD = REACH;
    if (radius > 0) hits = this.cars.filter((c) => !c.wreck && Math.hypot(c.car.root.x - at.x, c.car.root.y - at.y) <= radius);
    else for (const c of this.cars) {
      const d = Math.hypot(c.car.root.x - at.x, c.car.root.y - at.y);
      if (!c.wreck && d <= bestD) { hits = [c]; bestD = d; }
    }
    for (const c of hits) {
      c.wreck = RESPAWN;
      c.car.root.visible = false;
      boom(this.layer, c.car.root.x, c.car.root.y, c.bike ? 0.5 : 1);
    }
    return hits.length > 0;
  }

  update(dtMs: number): void {
    for (const c of this.cars) {
      if (!c.wreck) continue;
      c.wreck = Math.max(0, c.wreck - dtMs);
      if (!c.wreck) { c.state = this.spawn(c.bike); c.waited = 0; c.car.root.visible = true; }
    }
    // a wreck takes no road space
    const where = this.cars.map((c) => (c.wreck ? { x: -1e6, y: -1e6, dx: 0, dy: 0 } : inLane(carPos(this.graph, c.state))));
    this.cars.forEach((c, i) => {
      if (c.wreck) return;
      const others = where.filter((_, j) => j !== i);
      const w = where[i]!;
      if (holdAtGate(crossingClosed(), w.x, w.y, w.dx, w.x + w.dx * c.state.speed * dtMs)) return; // barrier down: wait at the line, however long
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
