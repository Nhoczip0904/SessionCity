import { Application, Container, Rectangle, Sprite, Texture, TextureStyle, type Graphics } from "pixi.js";
import type { Employee, Session } from "../shared/types.js";
import { Actors } from "./actors.js";
import { TILE, buildCity } from "./city.js";
import { createHud } from "./hud.js";
import { renderLaunchDialog, showDialog, showRules, type ExploreState, type LaunchOpts } from "./launcher.js";
import { connect } from "./net.js";
import { Panel, type Detail, type Kind } from "./panel.js";
import { loadSheets } from "./tiles.js";
import { Tooltip, plotAt, presentAt, renderDistrictCard } from "./tooltip.js";
import { Traffic } from "./traffic.js";
import { districtInfo } from "../shared/districts.js";

const HUD_H = 32;
const NO_SESSIONS = "Chưa thấy phiên Claude Code nào trong ~/.claude/projects — mở Claude Code rồi quay lại.";
const NO_TOKEN = "Thiếu token — mở đúng đường dẫn server in ra";

/** Static light: slightly warm top-left, slightly dark bottom-right; drawn once. */
function lightOverlay(w: number, h: number): Sprite {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "rgba(255, 214, 150, 0.12)");
  grad.addColorStop(0.5, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(16, 24, 56, 0.16)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const s = new Sprite(Texture.from(cv));
  s.eventMode = "none";
  return s;
}

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

  const sheets = await loadSheets(); // null → procedural art
  const city = buildCity(sheets);
  const W = city.cols * TILE, H = city.rows * TILE;
  // map drawn once into a 2× texture: crisp pixel art and readable baked labels
  const mapTex = app.renderer.generateTexture({ target: city.draw(), frame: new Rectangle(0, 0, W, H), resolution: 2 });
  const world = new Container();
  const cars = new Container();
  const layer = new Container();
  world.addChild(new Sprite(mapTex), cars);
  if (sheets) world.addChild(lightOverlay(W, H));
  world.addChild(layer);
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

  const bake = (g: Graphics) => app.renderer.generateTexture({ target: g, resolution: 1 });
  const tip = new Tooltip(document.getElementById("tooltip")!);
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const fetchDetail = async (kind: Kind, id: string): Promise<Detail | "gone"> => {
    const res = await fetch(`/api/${kind}/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
    if (res.status === 404) return "gone";
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Detail;
  };
  /** JSON call to a token-guarded endpoint → parsed body, or a Vietnamese error message. */
  const send = async (method: string, path: string, body?: LaunchOpts | { enabled: boolean }): Promise<{ state: ExploreState } | string> => {
    let res: Response;
    try {
      res = await fetch(`${path}?token=${encodeURIComponent(token)}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      return "Không kết nối được server";
    }
    let data: { error?: string; state?: ExploreState } | null = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) return data?.error ?? `Lỗi ${res.status}`;
    return { state: data?.state as ExploreState };
  };
  const panelRoot = document.getElementById("panel")!;
  const panel = new Panel(panelRoot, fetchDetail);
  const onPick = (kind: Kind, id: string) => {
    tip.hide();
    void panel.open(kind, id);
  };
  const actors = new Actors(city, layer, bake, sheets, onPick);
  const traffic = new Traffic(city, cars, sheets);
  app.ticker.add((t) => {
    actors.update(t.deltaMS);
    traffic.update(t.deltaMS);
  });

  const sessions = new Map<string, Session>();
  const employees = new Map<string, Employee>();
  const hud = createHud({
    launch: () => {
      const folders = [...new Set([...sessions.values()].map((s) => s.cwd).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
      showDialog(renderLaunchDialog(folders, (o) => send("POST", "/api/launch", o).then((r) => (typeof r === "string" ? r : null))));
    },
    rules: () =>
      void showRules(
        () => send("GET", "/api/agents/explore").then((r) => (typeof r === "string" ? r : r.state)),
        (enabled) => send("PUT", "/api/agents/explore", { enabled }).then((r) => (typeof r === "string" ? r : r.state)),
      ),
  });
  const apply = () => {
    const state = { sessions: [...sessions.values()], employees: [...employees.values()] };
    actors.sync(state);
    hud.setCounts(state.sessions);
    hud.setHint(state.sessions.length ? null : NO_SESSIONS);
  };

  // hover card: pointer → map pixels → plot
  let pointer: PointerEvent | null = null;
  const hover = () => {
    if (!pointer) return tip.hide();
    const mx = (pointer.clientX - world.x) / world.scale.x, my = (pointer.clientY - world.y) / world.scale.y;
    const plot = plotAt(city.plots, mx, my);
    if (!plot) return tip.hide();
    const present = presentAt(plot.id, [...sessions.values()], [...employees.values()]);
    tip.show(renderDistrictCard(districtInfo(plot.id), present), pointer.clientX, pointer.clientY, innerWidth, innerHeight);
  };
  app.canvas.addEventListener("pointermove", (e) => {
    pointer = e;
    hover();
  });
  app.canvas.addEventListener("pointerleave", () => {
    pointer = null;
    tip.hide();
  });
  panelRoot.addEventListener("pointerenter", () => {
    pointer = null;
    tip.hide();
  });

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
      panel.onDelta(d);
    },
    (c) => {
      hud.setConn(c);
      if (c === "auth") hud.setHint(NO_TOKEN);
    },
  );
}

void main();
