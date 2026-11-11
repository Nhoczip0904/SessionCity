import { Container, Sprite } from "pixi.js";
import { ROAD_COLS, ROAD_ROWS, TILE } from "./city.js";
import { carPos, centreLines, gapAhead, inLane, roadGraph, spawnCar, stepCar, type CarState, type RoadGraph } from "./roads.js";
import { CARS, CARS_DOWN, CARS_UP, type Sheets } from "./tiles.js";

const COUNT = 6;
const SCALE = 0.5; // half size, so two cars pass side by side on a 2-tile road
const MIN_GAP = 1.8; // tiles kept to the car in front (a car is 1.5 tiles long at this scale)
const MAX_WAIT = 2500; // ms; then drive on anyway, so a jam at a crossing always clears

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
  private cars: { car: Car; state: CarState; waited: number }[] = [];
  private graph: RoadGraph;

  constructor(layer: Container, sheets: Sheets | null, private rand: () => number = Math.random) {
    layer.eventMode = "none";
    // centre lines of the 2-tile roads; cars drive in the right-hand lane beside them
    this.graph = roadGraph(centreLines(ROAD_COLS), centreLines(ROAD_ROWS));
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
      this.cars.push({ car, state: spawnCar(this.graph, this.rand), waited: 0 });
    }
    this.update(0);
  }

  update(dtMs: number): void {
    const where = this.cars.map((c) => inLane(carPos(this.graph, c.state)));
    this.cars.forEach((c, i) => {
      const others = where.filter((_, j) => j !== i);
      if (gapAhead(where[i], others) >= MIN_GAP || c.waited > MAX_WAIT) {
        stepCar(this.graph, c.state, dtMs, this.rand);
        c.waited = 0;
      } else c.waited += dtMs;
    });
    for (const { car, state } of this.cars) {
      const { x, y, dx, dy } = inLane(carPos(this.graph, state));
      car.root.position.set(Math.round(x * TILE), Math.round(y * TILE));
      car.side.visible = dx !== 0;
      car.side.scale.x = dx > 0 ? -1 : 1; // the side view faces left
      car.up.visible = dy < 0;
      car.down.visible = dy > 0;
    }
  }
}
