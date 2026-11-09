import { Application, Container, Rectangle, Sprite, TextureStyle, type Graphics } from "pixi.js";
import type { Employee, Session } from "../shared/types.js";
import { Actors } from "./actors.js";
import { TILE, buildCity } from "./city.js";
import { createHud } from "./hud.js";
import { connect } from "./net.js";

const HUD_H = 32;
const NO_SESSIONS = "Chưa thấy phiên Claude Code nào trong ~/.claude/projects — mở Claude Code rồi quay lại.";
const NO_TOKEN = "Thiếu token — mở đúng đường dẫn server in ra";

async function main() {
  TextureStyle.defaultOptions.scaleMode = "nearest";
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x2f4a2a,
    antialias: false,
    roundPixels: true,
    resolution: devicePixelRatio,
    autoDensity: true,
  });
  document.getElementById("app")!.appendChild(app.canvas);

  const city = buildCity();
  const W = city.cols * TILE, H = city.rows * TILE;
  // map drawn once into a 2× texture: crisp pixel art and readable baked labels
  const mapTex = app.renderer.generateTexture({ target: city.draw(), frame: new Rectangle(0, 0, W, H), resolution: 2 });
  const world = new Container();
  const layer = new Container();
  world.addChild(new Sprite(mapTex), layer);
  app.stage.addChild(world);

  const layout = () => {
    const sw = app.screen.width, sh = app.screen.height - HUD_H;
    const fit = Math.min(sw / W, sh / H);
    const s = fit >= 2 ? Math.floor(fit) : fit; // integer scale when ≥ 2× fits, else fill the window
    world.scale.set(s);
    world.position.set(Math.round((sw - W * s) / 2), Math.round(HUD_H + (sh - H * s) / 2));
  };
  layout();
  app.renderer.on("resize", layout);

  const actors = new Actors(city, layer, (g: Graphics) => app.renderer.generateTexture({ target: g, resolution: 1 }));
  app.ticker.add((t) => actors.update(t.deltaMS));

  const hud = createHud();
  const sessions = new Map<string, Session>();
  const employees = new Map<string, Employee>();
  const apply = () => {
    const state = { sessions: [...sessions.values()], employees: [...employees.values()] };
    actors.sync(state);
    hud.setCounts(state.sessions);
    hud.setHint(state.sessions.length ? null : NO_SESSIONS);
  };

  connect(
    (s) => {
      sessions.clear();
      employees.clear();
      s.sessions.forEach((x) => sessions.set(x.id, x));
      s.employees.forEach((x) => employees.set(x.id, x));
      apply();
    },
    (d) => {
      d.sessions.forEach((x) => sessions.set(x.id, x));
      d.employees.forEach((x) => employees.set(x.id, x));
      for (const id of d.removed) {
        sessions.delete(id);
        employees.delete(id);
      }
      apply();
    },
    (c) => {
      hud.setConn(c);
      if (c === "auth") hud.setHint(NO_TOKEN);
    },
  );
}

void main();
