import { Application, Assets, Container, Rectangle, Sprite, Texture, TextureStyle, type Graphics } from "pixi.js";
import type { BuildingData, BuildingId, Employee, RepoPrs, Session, SessionDetail, Shelf } from "../shared/types.js";
import { Actors } from "./actors.js";
import { flyRock } from "./rock.js";
import { TILE, buildCity } from "./city.js";
import { createHud } from "./hud.js";
import { confirmDialog, renderLaunchDialog, showDialog, showRules, type ExploreState, type LaunchOpts } from "./launcher.js";
import { connect } from "./net.js";
import { ROOM_COLS, ROOM_ROWS, DEFAULT_THEME, OFFICE_THEME, ROOM_THEMES, deskSpots, fileRows, officeLayout, roomOccupants, tokenRows, type Furniture, type RoomTheme } from "./rooms.js";
import { drawRoom, type Seat } from "./roomDraw.js";
import { Scene, type Place } from "./scene.js";
import { renderFilesDialog, renderPrDialog, renderShelfDialog, renderTokenDialog } from "./shelfDialog.js";
import { flyPaper, handoffs } from "./handoff.js";
import { isChatOpen, openChat } from "./chat.js";
import { isTerminalOpen, openTerminal } from "./term.js";
import { renderBuildingDialog } from "./buildings.js";
import { BUSY_CONFIRM, Panel, type Detail, type Kind } from "./panel.js";
import { loadSheets } from "./tiles.js";
import { Tooltip, plotAt, presentAt, renderDistrictCard } from "./tooltip.js";
import { Traffic } from "./traffic.js";
import { Ruins } from "./blast.js";
import { Cross, photoDataUrl } from "./cross.js";
import { AgentList } from "./agentList.js";
import { districtInfo } from "../shared/districts.js";

const HUD_H = 32;
const NAV_W = 200; // the agent index down the left edge, when shown
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

const PLAZA_KEY = "backendcity.plaza", PHOTO_KEY = "backendcity.photo", AGENTS_KEY = "backendcity.agents";
// localStorage can be missing or full (private window, blocked site data): the square still works, it just forgets
const load = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k: string, v: string): boolean => {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
};
const textureOf = async (url: string): Promise<Texture> => {
  const img = new Image();
  img.src = url;
  await img.decode();
  return Texture.from(img);
};

async function main() {
  // before the slow sheet load, so a hidden column does not flash
  const navHidden = load(AGENTS_KEY) === "0";
  document.getElementById("agents")!.hidden = navHidden;
  document.getElementById("btn-agents")!.setAttribute("aria-pressed", String(!navHidden));
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
  // the square below the city can be switched off: the map is then cut off above it
  const cityH = city.plaza.y;
  const cityTex = new Texture({ source: mapTex.source, frame: new Rectangle(0, 0, W, cityH) });
  const map = new Sprite(mapTex);
  const light = lightOverlay(W, H);
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  world.addChild(map);
  if (motion) world.addChild(city.ripples());
  world.addChild(cars);
  if (sheets) world.addChild(light);
  let plazaOn = load(PLAZA_KEY) !== "0";
  const agentsOn = load(AGENTS_KEY) !== "0";
  let navW = agentsOn ? NAV_W : 0;
  let mapH = plazaOn ? H : cityH;
  const rubble = new Container(); // building ruins sit under people and cars
  world.addChild(rubble, layer);
  const roomLayer = new Container();
  roomLayer.sortableChildren = true;
  const papers = new Container(); // task papers in flight; outlive room rebuilds
  papers.zIndex = 1;
  roomLayer.addChild(papers);
  app.stage.addChild(world, roomLayer);

  const fitTo = (c: Container, w: number, h: number) => {
    const sw = app.screen.width - navW, sh = app.screen.height - HUD_H;
    const fit = Math.min(sw / w, sh / h);
    const s = fit >= 2 ? Math.floor(fit) : fit; // integer scale when ≥ 2× fits, else fill the window
    c.scale.set(s);
    c.position.set(Math.round(navW + (sw - w * s) / 2), Math.round(HUD_H + (sh - h * s) / 2));
  };
  const layout = () => {
    fitTo(world, W, mapH);
    fitTo(roomLayer, ROOM_COLS * TILE, ROOM_ROWS * TILE);
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
  const send = async (method: string, path: string, body?: LaunchOpts | { enabled: boolean } | Record<string, never>): Promise<{ state: ExploreState } | string> => {
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
  const panel = new Panel(panelRoot, fetchDetail, {
    isOpen: () => (isChatOpen() ? "chat" : isTerminalOpen() ? "terminal" : null),
    chat: (d) => chatWith(d.id, d.project),
    terminal: (d) => openTerminal({ sessionId: d.id, title: d.project, token, onClose: () => refreshIfShown(d.id) }),
    confirm: (t) => confirmDialog(t, "Vẫn mở", "Huỷ"),
  });
  let latest: Session[] = []; // the sessions as last synced, for the chat's session menu
  const chatWith = (id: string, title: string) =>
    openChat({
      sessionId: id, title, token, onClose: () => refreshIfShown(id),
      menu: { sessions: () => latest, avatarOf: (sid) => avatarOf(sid), pick: (sid) => void (latest.find((x) => x.id === sid) && chatWith(sid, latest.find((x) => x.id === sid)!.project)) },
    });
  const refreshIfShown = (id: string) => {
    if (panel.shows("session", id)) void panel.open("session", id);
  };
  const onPick = (kind: Kind, id: string) => {
    tip.hide();
    void panel.open(kind, id);
  };
  const onEnter = (p: Place) => {
    tip.hide();
    scene.enter(p);
  };
  const actors = new Actors(city, layer, bake, sheets, onPick, onEnter);
  // avatars: each mayor's figure from the map, drawn once into a small image
  const avatars = new Map<string, string>();
  const avatarOf = (id: string): string | null => {
    const hit = avatars.get(id);
    if (hit) return hit;
    const fig = actors.portrait("session", id);
    if (!fig) return null;
    const url = (app.renderer.extract.canvas(fig) as HTMLCanvasElement).toDataURL();
    fig.destroy({ children: true });
    avatars.set(id, url);
    return url;
  };
  const agentList = new AgentList(document.getElementById("agents")!, onPick, avatarOf);
  const traffic = new Traffic(cars, sheets);
  const ruins = new Ruins(rubble, [...city.plots.map((p) => p.px), ...city.hqPlots]);
  // the photo is a local, git-ignored file (public/cross.png); without it the cross hangs a blank card
  const saved = load(PHOTO_KEY);
  const photo = (saved ? await textureOf(saved).catch(() => null) : null) ?? (await Assets.load<Texture>("/cross.png").catch(() => null));
  const pz = city.plaza;
  const cross = new Cross(rubble, { x: pz.x + pz.w / 2 - 32, y: pz.y + 22, w: 64, h: 114 }, photo);
  // rock mode: a see-through sheet over the map takes the clicks; stones fly from the bottom edge of the map
  const aim = new Container();
  const showPlaza = (on: boolean) => {
    plazaOn = on;
    mapH = on ? H : cityH;
    map.texture = on ? mapTex : cityTex;
    light.height = mapH;
    aim.hitArea = new Rectangle(0, 0, W, mapH);
    cross.show(on);
    layout();
  };
  aim.eventMode = "none";
  aim.cursor = "crosshair";
  aim.on("pointertap", (e) => {
    const to = e.getLocalPosition(layer);
    flyRock(layer, { x: to.x * 0.6 + W * 0.2, y: mapH }, to, () => void (actors.hit(to) || traffic.hit(to) || cross.hit(to) || ruins.hit(to)));
  });
  world.addChild(aim);
  showPlaza(plazaOn);
  app.ticker.add((t) => {
    actors.update(t.deltaMS);
    traffic.update(t.deltaMS);
    ruins.update(t.deltaMS);
    cross.update(t.deltaMS);
  });

  const sessions = new Map<string, Session>();
  const employees = new Map<string, Employee>();
  const openLaunch = (preset?: string) => {
    const folders = [...new Set([...sessions.values()].map((s) => s.cwd).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    showDialog(renderLaunchDialog(folders, (o) => send("POST", "/api/launch", o).then((r) => (typeof r === "string" ? r : null)), preset || undefined));
  };
  const shelfGet = async <T,>(id: string, item?: string): Promise<T> => {
    const res = await fetch(`/api/session/${encodeURIComponent(id)}/shelf${item ? `/${encodeURIComponent(item)}` : ""}?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  };

  /** A department's board: chat opens only after the same warning the session panel gives for a busy session. */
  const openBuilding = (id: BuildingId) =>
    showDialog(renderBuildingDialog(id, async (fresh) => {
      const res = await fetch(`/api/building/${id}?token=${encodeURIComponent(token)}${fresh ? "&fresh=1" : ""}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as BuildingData;
    }, {
      avatarOf: (sid) => avatarOf(sid),
      now: () => Date.now(),
      chat: (sid) => void (async () => {
        const s = sessions.get(sid);
        if (!s || (s.status !== "idle" && !(await confirmDialog(BUSY_CONFIRM, "Vẫn mở", "Huỷ")))) return;
        chatWith(sid, s.project);
      })(),
    }));
  let lastDetail: SessionDetail | null = null; // updated on every show, even when the redraw is skipped
  const furniture = (f: Furniture) => {
    if (f === "prs") return showDialog(renderPrDialog(async (fresh) => {
      const res = await fetch(`/api/prs?token=${encodeURIComponent(token)}${fresh ? "&fresh=1" : ""}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as RepoPrs[];
    }));
    const d = lastDetail;
    if (!d) return;
    if (f === "safe") showDialog(renderTokenDialog(tokenRows(d)));
    else if (f === "cabinet") showDialog(renderFilesDialog(fileRows(d), (id) => void panel.open("employee", id)));
    else if (f === "phone") openLaunch(d.cwd);
    else if (f === "map") scene.enter({ kind: "room", district: d.district });
    else showDialog(renderShelfDialog(() => shelfGet<Shelf>(d.id), (item) => shelfGet(d.id, item)));
  };
  type Spec = { seats: { at: { x: number; y: number; back?: boolean }; kind: "session" | "employee"; id: string; label: string; badge: string; done: boolean; big?: boolean }[]; board: string[]; note: string | null; theme: RoomTheme };
  const spec = (place: Exclude<Place, { kind: "city" }>, detail: SessionDetail | null, error: boolean): Spec => {
    const seats: Spec["seats"] = [];
    if (place.kind === "room") {
      const info = districtInfo(place.district);
      const { people, extra } = roomOccupants(place.district, [...sessions.values()], [...employees.values()]);
      const theme = ROOM_THEMES[place.district] ?? DEFAULT_THEME;
      const spots = deskSpots(people.length, theme.layout);
      people.forEach((o, i) => seats.push({ at: spots[i], kind: o.kind, id: o.id, label: o.name, badge: o.badge, done: o.done, big: spots[i].big }));
      return {
        seats,
        board: [`${info.label} — ${info.sign}`, info.description, ...(info.examples.length ? [info.examples.join(", ")] : [])],
        note: people.length ? (extra ? `+${extra}` : null) : "Chưa ai làm ở đây",
        theme,
      };
    }
    const s = detail ?? sessions.get(place.sessionId);
    if (s) seats.push({ at: { x: 7, y: 3 }, kind: "session", id: s.id, label: s.project, badge: s.status === "waiting" ? "!" : s.status === "idle" ? "z" : "", done: false, big: true });
    const lay = detail ? officeLayout(detail) : null;
    const spots = deskSpots(lay?.staff.length ?? 0);
    lay?.staff.forEach((e, i) => seats.push({ at: spots[i], kind: "employee", id: e.id, label: e.name, badge: "", done: e.done }));
    const notes = [error ? "Không tải được, đang thử lại" : "", lay?.extra ? `+${lay.extra}` : ""].filter(Boolean);
    return { seats, board: lay?.board ?? [s?.title ?? s?.project ?? "—"], note: notes.length ? notes.join(" · ") : null, theme: OFFICE_THEME };
  };
  // staff of the office last drawn, to animate the mayor handing out tasks and getting reports back
  let seen: { id: string; staff: Map<string, boolean> } | null = null;
  const draw = (place: Exclude<Place, { kind: "city" }>, detail: SessionDetail | null, error: boolean) => {
    const v = spec(place, detail, error);
    if (place.kind === "office" && detail) {
      const staff = v.seats.filter((x) => x.kind === "employee");
      const boss = { x: 7.5 * TILE, y: 3 * TILE + 10 };
      if (motion) for (const h of handoffs(seen?.id === place.sessionId ? seen.staff : null, staff)) {
        const at = staff.find((x) => x.id === h.id)!.at, desk = { x: (at.x + 1) * TILE, y: at.y * TILE + (at.back ? -6 : 10) };
        flyPaper(papers, h.kind === "assign" ? boss : desk, h.kind === "assign" ? desk : boss, h.kind);
      }
      seen = { id: place.sessionId, staff: new Map(staff.map((x) => [x.id, x.done])) };
    }
    const seats: Seat[] = v.seats.map((x) => ({ at: x.at, big: x.big, fig: actors.portrait(x.kind, x.id), label: x.label, badge: x.badge, done: x.done, onPick: () => onPick(x.kind, x.id) }));
    const onFurniture = (f: Furniture) => (f === "building" && place.kind === "room" && place.district !== "review" ? openBuilding(place.district) : furniture(f));
    return drawRoom(sheets, v.theme, seats, v.board, v.note, onFurniture);
  };
  // only what the room visibly shows: anything else would rebuild it mid-tap
  const key = (place: Exclude<Place, { kind: "city" }>, detail: SessionDetail | null, error: boolean) => {
    lastDetail = detail;
    const { theme: _t, ...v } = spec(place, detail, error);
    return JSON.stringify([place, v]);
  };
  const scene = new Scene({
    mount: roomLayer,
    draw,
    key,
    fetchSession: (id) => fetchDetail("session", id) as Promise<SessionDetail | "gone">,
    onChange: (p) => {
      const inside = p.kind !== "city";
      seen = null;
      for (const c of [...papers.children]) c.destroy();
      world.visible = !inside;
      tip.hide();
      hud.setPlace(
        p.kind === "room" ? districtInfo(p.district).label : p.kind === "office" ? (sessions.get(p.sessionId)?.project ?? "") : null,
        () => scene.exit(),
      );
    },
  });
  const hud = createHud({
    rock: (armed) => (aim.eventMode = armed ? "static" : "none"),
    plaza: (on) => {
      showPlaza(on);
      store(PLAZA_KEY, on ? "1" : "0");
    },
    agents: (on) => {
      navW = on ? NAV_W : 0;
      layout();
      store(AGENTS_KEY, on ? "1" : "0");
    },
    photo: (file) =>
      void photoDataUrl(file)
        .then(async (url) => {
          cross.setPhoto(await textureOf(url));
          if (!store(PHOTO_KEY, url)) flash("Đã treo ảnh, nhưng trình duyệt không lưu được — tải lại trang sẽ mất");
        })
        .catch(() => flash("Không đọc được ảnh này — chọn file ảnh khác")),
    launch: () => openLaunch(),
    rules: () =>
      void showRules(
        () => send("GET", "/api/agents/explore").then((r) => (typeof r === "string" ? r : r.state)),
        (enabled) => send("PUT", "/api/agents/explore", { enabled }).then((r) => (typeof r === "string" ? r : r.state)),
      ),
  }, plazaOn, agentsOn);
  const flash = (text: string) => {
    hud.setHint(text);
    setTimeout(() => hud.setHint(null), 4000);
  };
  const apply = () => {
    const state = { sessions: [...sessions.values()], employees: [...employees.values()] };
    actors.sync(state);
    hud.setCounts(state.sessions);
    latest = state.sessions;
    agentList.render(state.sessions, state.employees);
    hud.setHint(state.sessions.length ? null : NO_SESSIONS);
    scene.redraw();
  };

  // hover card: pointer → map pixels → plot
  let pointer: PointerEvent | null = null;
  const hover = () => {
    if (!pointer || scene.place.kind !== "city") return tip.hide();
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
      if (scene.place.kind === "office" && !sessions.has(scene.place.sessionId)) scene.exit(); // stale after a reconnect
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
      scene.onDelta(d);
    },
    (c) => {
      hud.setConn(c);
      if (c === "auth") hud.setHint(NO_TOKEN);
    },
  );
}

void main();
