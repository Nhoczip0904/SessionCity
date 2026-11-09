import { Container, Sprite } from "pixi.js";
import { TILE, type buildCity } from "./city.js";
import { CARS, CARS_DOWN, CARS_UP, type Sheets } from "./tiles.js";

type City = ReturnType<typeof buildCity>;
const SPEED = 3 / 1000; // tiles per ms
const COUNT = 4;

interface Car { root: Container; side: Container; up: Container; down: Container; d: number }

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

/** Decorative cars driving clockwise around the ring road (no data, no input). */
export class Traffic {
  private cars: Car[] = [];
  private loop: { x: number; y: number }[];
  private len = 0;

  constructor(city: City, layer: Container, sheets: Sheets | null) {
    layer.eventMode = "none";
    // centre lines of the 2-tile ring road (tile edges 3 and cols-3 / rows-3); a car is as wide as the road, like the parked ones
    const lo = 3, right = city.cols - 3, bottom = city.rows - 3;
    this.loop = [{ x: lo, y: lo }, { x: right, y: lo }, { x: right, y: bottom }, { x: lo, y: bottom }];
    this.loop.forEach((p, i) => {
      const q = this.loop[(i + 1) % 4];
      this.len += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    });
    if (!sheets || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < COUNT; i++) {
      const k = i % CARS.length;
      const car: Car = {
        root: new Container(),
        side: block(sheets, CARS[k], 3),
        up: block(sheets, CARS_UP[k], 2),
        down: block(sheets, CARS_DOWN[k], 2),
        d: (i * this.len) / COUNT,
      };
      car.root.addChild(car.side, car.up, car.down);
      layer.addChild(car.root);
      this.cars.push(car);
    }
    this.update(0);
  }

  update(dtMs: number): void {
    for (const car of this.cars) {
      car.d = (car.d + dtMs * SPEED) % this.len;
      let d = car.d;
      for (let i = 0; i < 4; i++) {
        const p = this.loop[i], q = this.loop[(i + 1) % 4];
        const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y);
        const seg = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
        if (d > seg) { d -= seg; continue; }
        car.root.position.set(Math.round((p.x + dx * d) * TILE), Math.round((p.y + dy * d) * TILE));
        car.side.visible = dx !== 0;
        car.side.scale.x = dx > 0 ? -1 : 1; // the side view faces left
        car.up.visible = dy < 0;
        car.down.visible = dy > 0;
        break;
      }
    }
  }
}
