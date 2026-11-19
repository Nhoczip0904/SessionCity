import { Application, Container, Rectangle, Sprite, Texture, TextureStyle, type Graphics } from "pixi.js";
import type { AskRow, BuildingData, BuildingId, Employee, PrInfo, RepoPrs, Session, SessionDetail, Shelf } from "../shared/types.js";
import { Actors, animeFigure } from "./actors.js";
import { drawBoats } from "./boats.js";
import { flyRock } from "./rock.js";
import { BOLT_R, strike } from "./lightning.js";
import { METEOR_R, meteor } from "./meteor.js";
import { SAT_R, satellite } from "./satellite.js";
import { mountProps, type PropKind } from "./sandbox.js";
import { RELOAD, ZOOM, scope, shoot } from "./sniper.js";
import { ROADS, TILE, buildCity } from "./city.js";
import { FOREST, drawForest, drawTrain } from "./forest.js";
import { createHud } from "./hud.js";
import { mountNotes } from "./notes.js";
import { Ships } from "./ship.js";
import { Finishes, readDone, writeDone } from "./party.js";
import { confirmDialog, el, frame, renderLaunchDialog, showDialog, showRules, type ExploreState, type LaunchOpts } from "./launcher.js";
import { Alerts, withAsks } from "./alerts.js";
import { fillAsks, renderWaiting } from "./asks.js";
import { JobQueue } from "./queue.js";
import { renderSummary, summarize } from "./summary.js";
import { connect } from "./net.js";
import { ROOM_COLS, ROOM_ROWS, DEFAULT_THEME, LOBBY_THEME, HQ_THEME, OFFICE_THEME, ROOM_THEMES, deskSpots, lobbyDoors, hqRooms, meetings, reviewBoard, fileRows, officeLayout, roomOccupants, tokenRows, type Door, type Furniture, type RoomTheme } from "./rooms.js";
import { drawRoom, type Seat } from "./roomDraw.js";
import { Scene, type Place } from "./scene.js";
import { renderFilesDialog, renderPrBoard, renderShelfDialog, renderTokenDialog } from "./shelfDialog.js";
import { flyPaper, handoffs } from "./handoff.js";
import { openChat } from "./chat.js";
import { fixPrompt, renderBuildingDialog } from "./buildings.js";
import { BUSY_CONFIRM, Panel, type Detail, type Kind } from "./panel.js";
import { OUTFIT_CITIZEN, loadSheets } from "./tiles.js";
import { Tooltip, plotAt, presentAt, renderDistrictCard } from "./tooltip.js";
import { Traffic } from "./traffic.js";
import { Ruins } from "./blast.js";
import { AgentList } from "./agentList.js";
import { refreshMenus, setPrLoader } from "./chatMenu.js";
import { refreshStaff } from "./chatStaff.js";
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

const QUEUE_KEY = "backendcity.queue";
const PRESIDENT_KEY = "backendcity.president";
const AGENTS_KEY = "backendcity.agents", DONE_KEY = "backendcity.done";
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
  // map drawn once into a 4× texture: crisp pixel art and readable baked labels
  const mapTex = app.renderer.generateTexture({ target: city.draw(), frame: new Rectangle(0, 0, W, H), resolution: 4 });
  // the forest around the city, drawn once: the map above it covers the city itself
  const cityRows = city.plaza.y / TILE;
  const forestTex = app.renderer.generateTexture({
    target: drawForest(sheets, city.cols, city.rows, cityRows, ROADS, city.riverLeft),
    frame: new Rectangle(-FOREST * TILE, -FOREST * TILE, W + 2 * FOREST * TILE, H + 2 * FOREST * TILE),
    resolution: 1,
  });
  const forest = new Sprite(forestTex);
  forest.position.set(-FOREST * TILE, -FOREST * TILE);
  const world = new Container();
  const cars = new Container();
  const layer = new Container();
  const map = new Sprite(mapTex);
  // the light covers the forest too, or its edge would show where the city ends
  const light = lightOverlay(W + 2 * FOREST * TILE, H + 2 * FOREST * TILE);
  light.position.set(-FOREST * TILE, -FOREST * TILE);
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  world.addChild(forest, map);
  if (motion) world.addChild(city.ripples(), drawBoats(city.riverLeft, city.rows), drawTrain(city.rows, sheets ? (n) => animeFigure(sheets, 0, OUTFIT_CITIZEN, 50 + n * 3) : undefined));
  world.addChild(cars);
  if (sheets) world.addChild(light);
  const agentsOn = load(AGENTS_KEY) !== "0";
  let navW = agentsOn ? NAV_W : 0;
  const rubble = new Container(); // building ruins sit under people and cars
  const propsLayer = new Container(); // sandbox trees, lamps and benches
  world.addChild(rubble, propsLayer, layer);
  const props = mountProps(propsLayer, sheets, { getItem: load, setItem: store });
  let sandbox = false; // on: real sessions are hidden
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
  const base = { x: 0, y: 0, s: 1 }; // the map's resting place, before the sniper scope zooms it
  const layout = () => {
    fitTo(world, W, H);
    base.x = world.x; base.y = world.y; base.s = world.scale.x;
    fitTo(roomLayer, ROOM_COLS * TILE, ROOM_ROWS * TILE);
  };
  layout();
  app.renderer.on("resize", layout);

  const bake = (g: Graphics) => app.renderer.generateTexture({ target: g, resolution: 1 });
  const tip = new Tooltip(document.getElementById("tooltip")!);
  const fetchDetail = async (kind: Kind, id: string): Promise<Detail | "gone"> => {
    const res = await fetch(`/api/${kind}/${encodeURIComponent(id)}`);
    if (res.status === 404) return "gone";
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Detail;
  };
  /** JSON call to a token-guarded endpoint → parsed body, or a Vietnamese error message. */
  const send = async (method: string, path: string, body?: LaunchOpts | { enabled: boolean } | { session: string; id: string; allow: boolean } | Record<string, never>): Promise<{ state: ExploreState } | string> => {
    let res: Response;
    try {
      res = await fetch(`${path}`, {
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
  let prData: RepoPrs[] = []; // the PR board's last load, for the session panel
  setPrLoader(async (id) => {
  const res = await fetch(`/api/session/${encodeURIComponent(id)}/prs`);
  return res.ok ? ((await res.json()) as PrInfo[]) : [];
});
let president = load(PRESIDENT_KEY); // the session whose mayor is president
const panel = new Panel(panelRoot, fetchDetail, () => prData.flatMap((r) => r.prs), {
  is: (id) => id === president,
  toggle: (id) => {
    president = president === id ? null : id;
    store(PRESIDENT_KEY, president ?? "");
    actors.setPresident(president);
    return president === id;
  },
});
  let latest: Session[] = []; // the sessions as last synced, for the chat's session menu
  let lastChat: { id: string; title: string } | null = null;
  const chatWith = (id: string, title: string, replace?: string) => {
    lastChat = { id, title };
    openChat({
      sessionId: id, title, replace, onClose: () => refreshIfShown(id),
      menu: { sessions: () => latest, avatarOf: (sid) => avatarOf(sid), pick: (sid, replace) => void (latest.find((x) => x.id === sid) && chatWith(sid, latest.find((x) => x.id === sid)!.project, replace)) },
    });
  };
  // the HUD's Chat button slides the drawer in and out; with no chat open it reopens the last one (else the first session)
  document.getElementById("btn-chat")?.addEventListener("click", () => {
    const drawer = document.querySelector(".chat-overlay");
    if (drawer) return void drawer.classList.toggle("collapsed");
    const s = lastChat ?? (latest[0] && { id: latest[0].id, title: latest[0].project });
    if (s) chatWith(s.id, s.title);
  });
  const refreshIfShown = (id: string) => {
    if (panel.shows("session", id)) void panel.open("session", id);
  };
  // permission questions of the city's chat processes: a session holding one shows "!" and opens the question first
  let asks: AskRow[] = [];
  let asksBody: HTMLElement | null = null;
  const fillAsksDialog = () => asksBody?.isConnected && fillAsks(asksBody, asks, {
    label: (sid) => sessions.get(sid)?.title || sessions.get(sid)?.project || sid.slice(0, 8),
    avatarOf: (sid) => avatarOf(sid),
    answer: async (a, allow) => {
      const r = await send("POST", "/api/ask", { session: a.session, id: a.id, allow });
      return typeof r === "string" ? r : null;
    },
    open: (sid) => {
      asksBody?.closest(".dialog")?.remove();
      void panel.open("session", sid);
    },
  });
  /** The day so far: drawn at once from the sessions, again when the PR list arrives. */
  const openSummary = () => {
    const body = el("div");
    const root = frame("Tóm tắt hôm nay", body);
    root.classList.add("wide");
    const draw = (prs: RepoPrs[] | null) =>
      body.replaceChildren(renderSummary(summarize(withAsks([...sessions.values()], asks), Date.now(), prs), {
        avatarOf: (sid) => avatarOf(sid),
        now: () => Date.now(),
        queued: queue.size,
        open: (sid) => (root.remove(), onPick("session", sid)),
      }));
    draw(null);
    showDialog(root);
    void fetch(`/api/prs`)
      .then((r) => (r.ok ? (r.json() as Promise<RepoPrs[]>) : null))
      .then((prs) => prs && root.isConnected && draw(prs))
      .catch(() => {});
  };
  const openAsks = () => {
    asksBody = el("div");
    const root = frame("Cần bạn duyệt", asksBody);
    root.classList.add("asks");
    showDialog(root);
    fillAsksDialog();
  };
  /** A session waiting for a reply: show what Claude asked, with the way to answer. */
  const openWaiting = async (id: string) => {
    const s = sessions.get(id);
    const d = await fetchDetail("session", id).catch(() => "gone" as const);
    const said = d === "gone" || !("chat" in d) ? "" : (d.chat.find((c) => c.role === "claude")?.text ?? "");
    const root = frame(`${s?.title || s?.project || "Session"} đang chờ bạn`, renderWaiting(said, {
      chat: () => (root.remove(), chatWith(id, s?.project ?? "")),
      open: () => (root.remove(), void panel.open("session", id)),
    }));
    root.classList.add("asks");
    showDialog(root);
  };
  const onPick = (kind: Kind, id: string) => {
    tip.hide();
    if (kind === "session" && asks.some((a) => a.session === id)) return openAsks();
    if (kind === "session" && sessions.get(id)?.status === "waiting") return void openWaiting(id);
    void panel.open(kind, id);
  };
  const onEnter = (p: Place) => {
    tip.hide();
    scene.enter(p);
  };
  const actors = new Actors(city, layer, bake, sheets, onPick, onEnter);
  actors.setPresident(president || null);
  // avatars: each mayor's figure from the map, drawn once into a small image
  const avatars = new Map<string, string>();
  const face = (kind: "session" | "employee", id: string): string | null => {
    const hit = avatars.get(id);
    if (hit) return hit;
    const fig = actors.portrait(kind, id);
    if (!fig) return null;
    const url = (app.renderer.extract.canvas(fig) as HTMLCanvasElement).toDataURL();
    fig.destroy({ children: true });
    avatars.set(id, url);
    return url;
  };
  const avatarOf = (id: string) => face("session", id);
  const agentList = new AgentList(document.getElementById("agents")!, onPick, avatarOf);
  const traffic = new Traffic(cars, sheets);
  const ruins = new Ruins(rubble, [...city.plots.map((p) => p.px), ...city.hqPlots, ...city.decorPlots]);
  // rock mode: a see-through sheet over the map takes the clicks; stones fly from the bottom edge of the map
  const aim = new Container();
  aim.hitArea = new Rectangle(0, 0, W, H);
  aim.eventMode = "none";
  aim.cursor = "crosshair";
  let tool: "rock" | "grab" | "bolt" | "meteor" | "sniper" | "laser" | "sbx" | null = null;
  let sbxKind = "";
  const reticle = scope(layer);
  let lastShot = -RELOAD;
  const setTool = (t: "rock" | "grab" | "bolt" | "meteor" | "sniper" | "laser" | "sbx", armed: boolean) => {
    tool = armed ? t : tool === t ? null : tool;
    aim.eventMode = tool ? "static" : "none";
    aim.cursor = tool === "grab" ? "grab" : tool === "sniper" ? "none" : "crosshair";
    if (tool !== "sniper") { reticle.at(null); layout(); }
  };
  // throw mode: press on a person to pick them up, drag to carry, let go to fling
  aim.on("pointerdown", (e) => void (tool === "grab" && actors.grab(e.getLocalPosition(layer), e.timeStamp) && (aim.cursor = "grabbing")));
  aim.on("pointermove", (e) => {
    if (tool === "grab") actors.carry(e.getLocalPosition(layer), e.timeStamp);
    else if (tool === "sniper") {
      // zoom in around the scope: the map point under the cursor stays under it
      const g = e.global, mx = (g.x - base.x) / base.s, my = (g.y - base.y) / base.s;
      world.scale.set(base.s * ZOOM);
      world.position.set(g.x - mx * base.s * ZOOM, g.y - my * base.s * ZOOM);
      reticle.at({ x: mx, y: my });
    }
  });
  aim.on("pointerleave", () => { reticle.at(null); if (tool === "sniper") layout(); });
  const drop = (e: { timeStamp: number }) => {
    actors.release(e.timeStamp);
    if (tool === "grab") aim.cursor = "grab";
  };
  aim.on("pointerup", drop);
  aim.on("pointerupoutside", drop);
  aim.on("pointertap", (e) => {
    if (tool !== "rock" && tool !== "bolt" && tool !== "meteor" && tool !== "sniper" && tool !== "laser" && tool !== "sbx") return;
    const to = e.getLocalPosition(layer);
    const land = () => void (actors.hit(to) || traffic.hit(to) || ruins.hit(to));
    // a bolt is area damage: everything in its circle goes, not only the nearest thing
    const blast = (r: number) => () => void [actors, traffic, ruins].forEach((x) => x.hit(to, r));
    if (tool === "bolt") strike(layer, to, blast(BOLT_R), BOLT_R);
    else if (tool === "sniper") {
      if (e.timeStamp - lastShot < RELOAD) return;
      lastShot = e.timeStamp;
      shoot(layer, { x: to.x * 0.6 + W * 0.2, y: H }, to, land);
    } else if (tool === "meteor") meteor(layer, to, blast(METEOR_R), METEOR_R);
    else if (tool === "laser") satellite(layer, to, blast(SAT_R), SAT_R);
    else if (tool === "sbx") {
      if (sbxKind === "npc") actors.spawnCitizen(to);
      else if (sbxKind === "car") traffic.add();
      else if (sbxKind === "erase") props.erase(to, 14);
      else props.add(sbxKind as PropKind, to);
    }
    else flyRock(layer, { x: to.x * 0.6 + W * 0.2, y: H }, to, land);
  });
  world.addChild(aim);
  app.ticker.add((t) => {
    actors.update(t.deltaMS);
    traffic.update(t.deltaMS);
    ruins.update(t.deltaMS);
  });

  const sessions = new Map<string, Session>();
  const employees = new Map<string, Employee>();
  const queue = new JobQueue({ get: () => load(QUEUE_KEY), set: (v) => void store(QUEUE_KEY, v) });
  const openLaunch = (preset?: string, prompt?: string) => {
    const folders = [...new Set([...sessions.values()].map((s) => s.cwd).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    showDialog(renderLaunchDialog(folders, (o) => send("POST", "/api/launch", o).then((r) => (typeof r === "string" ? r : null)), preset || undefined, prompt, (o) => queue.add(o)));
  };
  const shelfGet = async <T,>(id: string, item?: string): Promise<T> => {
    const res = await fetch(`/api/session/${encodeURIComponent(id)}/shelf${item ? `/${encodeURIComponent(item)}` : ""}`);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  };

  /** A department's board: chat opens only after the same warning the session panel gives for a busy session. */
  const openBuilding = (id: BuildingId) =>
    showDialog(renderBuildingDialog(id, async (fresh) => {
      const res = await fetch(`/api/building/${id}${fresh ? "?fresh=1" : ""}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as BuildingData;
    }, {
      avatarOf: (sid) => avatarOf(sid),
      now: () => Date.now(),
      fix: (run) => {
        openLaunch([...sessions.values()].find((s) => s.project === run.project)?.cwd, fixPrompt(run));
      },
      chat: (sid) => void (async () => {
        const s = sessions.get(sid);
        if (!s || (s.status !== "idle" && !(await confirmDialog(BUSY_CONFIRM, "Vẫn mở", "Huỷ")))) return;
        chatWith(sid, s.project);
      })(),
    }));
  let lastDetail: SessionDetail | null = null; // updated on every show, even when the redraw is skipped
  document.body.append(renderPrBoard(async (fresh) => {
    const res = await fetch(`/api/prs${fresh ? "?fresh=1" : ""}`);
    if (!res.ok) throw new Error(String(res.status));
    return (prData = (await res.json()) as RepoPrs[]);
  }, 20_000, () => [...sessions.values()]));
  const furniture = (f: Furniture) => {
    const d = lastDetail;
    if (!d) return;
    if (f === "safe") showDialog(renderTokenDialog(tokenRows(d)));
    else if (f === "cabinet") showDialog(renderFilesDialog(fileRows(d), (id) => void panel.open("employee", id)));
    else if (f === "phone") openLaunch(d.cwd);
    else if (f === "map") scene.enter({ kind: "room", district: d.district });
    else showDialog(renderShelfDialog(() => shelfGet<Shelf>(d.id), (item) => shelfGet(d.id, item), (item) => void fetch(`/api/session/${encodeURIComponent(d.id)}/shelf/${item}/open`, { method: "POST" })));
  };
  type Spec = { doors?: Door[]; seats: { at: { x: number; y: number; back?: boolean }; kind: "session" | "employee"; id: string; label: string; badge: string; done: boolean; big?: boolean }[]; board: string[]; note: string | null; theme: RoomTheme };
  const spec = (place: Exclude<Place, { kind: "city" }>, detail: SessionDetail | null, error: boolean): Spec => {
    const seats: Spec["seats"] = [];
    if (place.kind === "room") {
      const info = districtInfo(place.district);
      if (place.district === "review" && !place.meeting) return { seats, doors: lobbyDoors([...sessions.values()]), board: [`${info.label} — ${info.sign}`, info.description, ...(info.examples.length ? [info.examples.join(", ")] : [])], note: null, theme: LOBBY_THEME };
      if (place.district === "home") return { seats, doors: hqRooms([...sessions.values()], [...employees.values()]), board: [`${info.label} — ${info.sign}`, "10 phòng, mỗi phòng một phiên"], note: null, theme: HQ_THEME };
      const { people, extra } = roomOccupants(place.district, [...sessions.values()], [...employees.values()], place.meeting);
      const theme = ROOM_THEMES[place.district] ?? DEFAULT_THEME;
      const spots = deskSpots(people.length, theme.layout);
      people.forEach((o, i) => seats.push({ at: spots[i], kind: o.kind, id: o.id, label: o.name, badge: o.badge, done: o.done, big: spots[i].big }));
      return {
        seats,
        board: [place.meeting ? reviewBoard([...sessions.values()], place.meeting) ?? `${info.label} — ${info.sign}` : `${info.label} — ${info.sign}`, info.description, ...(info.examples.length ? [info.examples.join(", ")] : [])],
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
    const onFurniture = (f: Furniture) => {
      if (f.startsWith("door:") && place.kind === "room" && place.district === "home") {
        const id = hqRooms([...sessions.values()])[Number(f.slice(5))]?.id;
        if (id) scene.enter({ kind: "office", sessionId: id });
        return;
      }
      if (f.startsWith("door:")) {
        const m = meetings([...sessions.values()])[Number(f.slice(5))];
        if (m) scene.enter({ kind: "room", district: "review", meeting: m.id });
        return;
      }
      return f === "building" && place.kind === "room" && place.district !== "review" ? openBuilding(place.district) : furniture(f);
    };
    return drawRoom(sheets, v.theme, seats, v.board, v.note, onFurniture, v.doors);
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
    rock: (armed) => setTool("rock", armed),
    bolt: (armed) => setTool("bolt", armed),
    meteor: (armed) => setTool("meteor", armed),
    sniper: (armed) => setTool("sniper", armed),
    laser: (armed) => setTool("laser", armed),
    sbx: (kind, armed) => {
      if (armed) sbxKind = kind;
      else if (sbxKind !== kind) return; // a newly armed tool already took over
      setTool("sbx", armed);
    },
    sandbox: (on) => {
      sandbox = on;
      apply();
    },
    grab: (armed) => setTool("grab", armed),
    agents: (on) => {
      navW = on ? NAV_W : 0;
      layout();
      store(AGENTS_KEY, on ? "1" : "0");
    },
    launch: () => openLaunch(),
    summary: () => openSummary(),
    rules: () =>
      void showRules(
        () => send("GET", "/api/agents/explore").then((r) => (typeof r === "string" ? r : r.state)),
        (enabled) => send("PUT", "/api/agents/explore", { enabled }).then((r) => (typeof r === "string" ? r : r.state)),
      ),
  }, agentsOn);
  const notesUrl = `/api/notes`;
mountNotes(document.getElementById("btn-notes")!, document.body, { getItem: load, setItem: store }, {
  load: () => fetch(notesUrl).then((r) => (r.ok ? r.json() : null)).then((b) => b?.notes ?? null).catch(() => null),
  save: (notes) => void fetch(notesUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) }).catch(() => {}),
});
  const flash = (text: string) => {
    hud.setHint(text);
    setTimeout(() => hud.setHint(null), 4000);
  };
  const alerts = new Alerts(
    {
      away: () => document.hidden || !document.hasFocus(),
      notify: (title, body, click) => {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const n = new Notification(title, { body, tag: title });
        n.onclick = () => (window.focus(), n.close(), click());
      },
      title: (t) => void (document.title = t),
    },
    document.title,
  );
  // browsers only ask for notifications after a click on the page
  addEventListener("pointerdown", () => typeof Notification !== "undefined" && Notification.permission === "default" && void Notification.requestPermission(), { once: true });
  const finishes = new Finishes();
  let meetingsSeen: Set<string> | null = null;
  const ships = new Ships();
  const today = () => new Date().toLocaleDateString("sv"); // local yyyy-mm-dd
  let doneToday = readDone(load(DONE_KEY), today());
  hud.setDone(doneToday);
  const apply = () => {
    const state = sandbox ? { sessions: [], employees: [] } : { sessions: withAsks([...sessions.values()], asks), employees: [...employees.values()] };
    alerts.update(state.sessions, sandbox ? [] : asks, (sid) => (asks.some((a) => a.session === sid) ? openAsks() : void panel.open("session", sid)));
    const job = queue.take(state.sessions);
    if (job) void send("POST", "/api/launch", job).then((r) => flash(typeof r === "string" ? `Hàng đợi: ${r}` : `Đã mở một việc từ hàng đợi (còn ${queue.size})`));
    actors.sync(state);
    const now = new Set(meetings(state.sessions).map((m) => m.id));
    if (meetingsSeen) for (const m of meetings(state.sessions)) if (!meetingsSeen.has(m.id)) flash(`Họp review: ${m.reviewing}`);
    meetingsSeen = now; // first look only records: reviews already running at load are not news
    for (const id of finishes.update(state.sessions)) {
      actors.cheer(id);
      doneToday = readDone(load(DONE_KEY), today()) + 1; // re-read: another tab may have counted too
      store(DONE_KEY, writeDone(today(), doneToday));
      hud.setDone(doneToday);
    }
    for (const sh of ships.update(state.sessions)) {
      actors.ship(sh.id, sh.kind);
      const s = state.sessions.find((x) => x.id === sh.id)!;
      const text = `${sh.kind === "push" ? "Đã push code" : "Đã mở PR"} · ${s.title || s.project}`;
      flash(`✈ ${text}`);
      alerts.tell(text, sh.kind === "push" ? "Code vừa được đẩy lên" : "Một pull request vừa được mở", () => void panel.open("session", sh.id));
    }
    hud.setCounts(state.sessions);
    latest = state.sessions;
    agentList.render(state.sessions, state.employees);
    refreshMenus(state.sessions);
    hud.setHint(state.sessions.length ? null : NO_SESSIONS);
    scene.redraw();
    refreshStaff(state.employees, (id) => face("employee", id)); // after the redraw: the map has to know the new subagent before it can draw its face
  };

  // hover card: pointer → map pixels → plot
  let pointer: PointerEvent | null = null;
  const hover = () => {
    if (!pointer || scene.place.kind !== "city") return tip.hide();
    const mx = (pointer.clientX - world.x) / world.scale.x, my = (pointer.clientY - world.y) / world.scale.y;
    const plot = plotAt(city.plots, mx, my);
    if (!plot) return tip.hide();
    const present = presentAt(plot.id, [...sessions.values()], [...employees.values()], avatarOf);
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
    (a) => {
      asks = a;
      apply();
      fillAsksDialog();
    },
  );
}

void main();
