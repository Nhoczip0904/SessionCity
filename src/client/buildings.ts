import type { Alert, BuildingData, BuildingId, ChangedFile, CmdRun, Doc } from "../shared/types.js";
import { el, frame } from "./launcher.js";

/** What a board needs from the app: the NPC portrait of a session, a way into its chat, and the clock. */
export interface BuildingCtx { avatarOf(sessionId: string): string | null; chat(sessionId: string): void; now(): number }

export const TITLES: Record<BuildingId, string> = {
  townhall: "Hộp thư — đang chờ bạn",
  home: "Phòng khách — phiên đang nghỉ",
  site: "Bản vẽ thi công — thay đổi chưa commit",
  lab: "Phòng thí nghiệm — kết quả test",
  factory: "Dây chuyền — các lần build",
  airport: "Bảng chuyến bay — push và deploy",
  watchtower: "Tháp canh — radar lỗi",
  library: "Kệ sách — file đọc nhiều nhất",
  design: "Bàn vẽ — spec và kế hoạch",
  database: "Sổ migration",
};

const base = (p: string) => p.split(/[\\/]/).pop() || p;
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const empty = (text: string) => el("div", text, "bd-empty");

/** "5 phút trước", "2 giờ trước"... */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}
const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "--:--");
export const seconds = (ms: number | null) => (ms === null ? "…" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

// ---- hộp thư: a letter per session that waits for you ----
function inbox(d: Extract<BuildingData, { id: "townhall" }>, ctx: BuildingCtx): HTMLElement {
  const root = el("div", undefined, "bd bd-inbox");
  if (!d.items.length) return empty("Không ai đang chờ bạn 🎉");
  for (const i of d.items) {
    const letter = el("article", undefined, "letter");
    const head = el("header");
    head.append(el("b", i.title || i.project), el("time", ago(i.at, ctx.now())));
    const reply = el("button", "Trả lời", "go");
    reply.type = "button";
    reply.onclick = () => ctx.chat(i.id);
    letter.append(head, el("blockquote", i.said || "(chưa có lời nhắn)"), el("footer", i.project), reply);
    root.append(letter);
  }
  return root;
}

// ---- phòng khách: sleepers in armchairs ----
function lounge(d: Extract<BuildingData, { id: "home" }>, ctx: BuildingCtx): HTMLElement {
  if (!d.items.length) return empty("Không ai đang nghỉ");
  const root = el("div", undefined, "bd bd-lounge");
  for (const i of d.items) {
    const chair = el("button", undefined, "chair");
    chair.type = "button";
    chair.title = "Đánh thức: mở chat";
    chair.onclick = () => ctx.chat(i.id);
    const ava = ctx.avatarOf(i.id);
    const face = el("div", undefined, "face");
    if (ava) {
      const img = el("img");
      img.src = ava;
      img.alt = "";
      face.append(img);
    }
    face.append(el("span", "z z z", "zzz"));
    chair.append(face, el("b", i.title || i.project), el("small", `ngủ ${ago(i.since, ctx.now()).replace(" trước", "")}`));
    root.append(chair);
  }
  return root;
}

// ---- bản vẽ thi công: a wall of bricks, one per changed file ----
const KIND: Record<ChangedFile["status"], string> = { M: "sửa", A: "mới", D: "xoá", "?": "chưa theo dõi" };
function wall(d: Extract<BuildingData, { id: "site" }>): HTMLElement {
  const root = el("div", undefined, "bd bd-wall");
  if (!d.repos.length) return empty("Chưa có phiên nào trong repo git");
  for (const r of d.repos) {
    const add = r.files.reduce((n, f) => n + f.add, 0), del = r.files.reduce((n, f) => n + f.del, 0);
    const head = el("h3", r.repo);
    head.append(" ", el("span", `+${add}`, "plus"), " ", el("span", `−${del}`, "minus"));
    root.append(head);
    if (r.error) root.append(el("div", r.error, "bd-empty"));
    else if (!r.files.length) root.append(empty("Sạch: không có gì chưa commit"));
    else {
      const bricks = el("div", undefined, "bricks");
      for (const f of r.files) {
        const b = el("div", undefined, `brick k${f.status === "?" ? "u" : f.status}`);
        b.style.flexGrow = String(Math.min(6, 1 + Math.round(Math.sqrt(f.add + f.del) / 2)));
        b.title = `${f.path}\n${KIND[f.status]} · +${f.add} −${f.del}`;
        b.append(el("span", base(f.path)));
        bricks.append(b);
      }
      root.append(bricks);
    }
  }
  root.append(el("div", "xanh: mới · vàng: sửa · đỏ: xoá · xám: chưa theo dõi — gạch to = nhiều dòng đổi", "legend"));
  return root;
}

// ---- phòng thí nghiệm: a rack of test tubes ----
function tubes(d: { runs: CmdRun[] }, ctx: BuildingCtx): HTMLElement {
  if (!d.runs.length) return empty("Chưa thấy lần chạy test nào");
  const root = el("div", undefined, "bd bd-lab");
  const last = d.runs[0];
  const screen = el("div", undefined, `monitor ${last.ok === null ? "run" : last.ok ? "ok" : "bad"}`);
  screen.append(el("b", last.ok === null ? "… đang chạy" : last.ok ? "✓ PASS" : "✗ FAIL"), el("span", last.note || last.command), el("small", `${last.project} · ${ago(last.at, ctx.now())} · ${seconds(last.ms)}`));
  const rack = el("div", undefined, "rack");
  for (const r of [...d.runs].slice(0, 16).reverse()) {
    const t = el("div", undefined, `tube ${r.ok === null ? "run" : r.ok ? "ok" : "bad"}`);
    t.title = `${r.command}\n${r.note}\n${r.project} · ${ago(r.at, ctx.now())}`;
    t.append(el("i"));
    rack.append(t);
  }
  root.append(screen, rack, el("div", `${d.runs.filter((r) => r.ok).length}/${d.runs.length} lần gần nhất đạt`, "legend"));
  return root;
}

// ---- dây chuyền: builds ride a conveyor belt ----
function belt(d: { runs: CmdRun[] }, ctx: BuildingCtx): HTMLElement {
  if (!d.runs.length) return empty("Chưa thấy lần build nào");
  const root = el("div", undefined, "bd bd-belt");
  const track = el("div", undefined, "track");
  const times = d.runs.map((r) => r.ms ?? 0);
  const longest = Math.max(1, ...times);
  for (const r of [...d.runs].slice(0, 12).reverse()) {
    const box = el("div", undefined, `crate ${r.ok === null ? "run" : r.ok ? "ok" : "bad"}`);
    box.style.minWidth = `${52 + Math.round(((r.ms ?? 0) / longest) * 70)}px`; // a longer build is a bigger crate
    box.title = `${r.command}\n${r.note}\n${r.project} · ${ago(r.at, ctx.now())}`;
    box.append(el("b", r.ok === null ? "…" : r.ok ? "✓" : "✗"), el("small", seconds(r.ms)));
    track.append(box);
  }
  const done = d.runs.filter((r) => r.ms !== null);
  const avg = done.length ? done.reduce((n, r) => n + (r.ms ?? 0), 0) / done.length : null;
  root.append(track, el("div", undefined, "wheels"), el("div", `${d.runs.length} lần build${avg === null ? "" : ` · trung bình ${seconds(Math.round(avg))}`} · hộp to = build lâu`, "legend"));
  const bad = d.runs.find((r) => r.ok === false);
  if (bad) root.append(el("div", `Lỗi gần nhất: ${bad.note || bad.command}`, "legend bad"));
  return root;
}

// ---- bảng chuyến bay: a departure board ----
const FLIGHT = (r: CmdRun) => (r.ok === null ? ["ĐANG BAY", "air"] : r.ok ? ["ĐÃ CẤT CÁNH", "go"] : ["HOÃN", "hold"]) as [string, string];
function departures(d: Extract<BuildingData, { id: "airport" }>, ctx: BuildingCtx): HTMLElement {
  const root = el("div", undefined, "bd bd-board");
  const row = (cells: (string | HTMLElement)[], cls = "") => {
    const r = el("div", undefined, `flight ${cls}`);
    cells.forEach((c, i) => r.append(typeof c === "string" ? el("span", c, `c${i}`) : c));
    return r;
  };
  root.append(row(["GIỜ", "CHUYẾN", "TRẠNG THÁI"], "head"));
  if (!d.flights.length) root.append(row(["", "chưa có chuyến nào", ""]));
  for (const f of d.flights.slice(0, 12)) {
    const [text, cls] = FLIGHT(f);
    root.append(row([clock(f.at), `${f.project} › ${f.command}`, el("span", text, `c2 ${cls}`)]));
  }
  root.append(row(["", "ĐƯỜNG BĂNG — CI", ""], "head"));
  if (!d.ci.length) root.append(row(["", "không có repo", ""]));
  for (const r of d.ci) {
    if (r.error) root.append(row(["", r.repo, el("span", r.error, "c2 hold")]));
    for (const c of r.runs.slice(0, 4)) {
      const t = el("span", c.state === "pass" ? "THÔNG" : c.state === "fail" ? "CHẶN" : "CHỜ", `c2 ${c.state === "pass" ? "go" : c.state === "fail" ? "hold" : "air"}`);
      root.append(row([clock(c.at), `${r.repo} › ${c.name} (${c.branch})`, t]));
    }
  }
  void ctx;
  return root;
}

// ---- tháp canh: a green radar feed ----
function radar(d: Extract<BuildingData, { id: "watchtower" }>, ctx: BuildingCtx): HTMLElement {
  const root = el("div", undefined, "bd bd-radar");
  const screen = el("div", undefined, "feed");
  if (!d.alerts.length) screen.append(el("div", "> không có tín hiệu lạ", "line quiet"));
  for (const a of d.alerts as Alert[]) {
    const line = el("div", undefined, "line");
    line.append(el("span", `[${clock(a.at)}]`, "t"), " ", el("span", `${a.project}›${a.tool}`, "who"), " ", el("span", a.text));
    line.title = ago(a.at, ctx.now());
    screen.append(line);
  }
  root.append(el("div", `${d.alerts.length} cảnh báo · ${new Set(d.alerts.map((a) => a.project)).size} phiên`, "sweep"), screen);
  return root;
}

// ---- kệ sách: spines of the most read files ----
const SPINES = ["#8b4a3c", "#3f6f5a", "#3f5f8f", "#7a5a8a", "#a07a3a", "#5a6a4a", "#8a4a5a", "#4a6a7a"];
function shelf(d: Extract<BuildingData, { id: "library" }>): HTMLElement {
  if (!d.books.length) return empty("Chưa ai đọc file nào");
  const root = el("div", undefined, "bd bd-shelf");
  const row = el("div", undefined, "books");
  const most = d.books[0]!.reads;
  for (const b of d.books) {
    const spine = el("div", undefined, "book");
    spine.style.height = `${90 + Math.round((b.reads / most) * 110)}px`;
    spine.style.background = SPINES[hash(b.path) % SPINES.length]!;
    spine.title = `${b.path}\n${b.reads} lần đọc · ${b.project}`;
    spine.append(el("span", base(b.path)), el("small", `×${b.reads}`));
    row.append(spine);
  }
  root.append(row, el("div", undefined, "plank"), el("div", "sách càng cao càng được đọc nhiều", "legend"));
  return root;
}

// ---- bàn vẽ: sheets of paper pinned to the board ----
function papers(d: Extract<BuildingData, { id: "design" }>, ctx: BuildingCtx): HTMLElement {
  if (!d.docs.length) return empty("Chưa thấy spec hay kế hoạch nào trong docs/");
  const root = el("div", undefined, "bd bd-papers");
  d.docs.forEach((p: Doc, i) => {
    const sheet = el("article", undefined, `sheet t${i % 3}`);
    sheet.title = p.path;
    sheet.append(el("b", p.title), el("small", `${p.repo} · ${base(p.path)}`));
    if (p.total) {
      const bar = el("div", undefined, "bar");
      const fill = el("i");
      fill.style.width = `${Math.round((p.done / p.total) * 100)}%`;
      bar.append(fill);
      sheet.append(bar, el("small", `${p.done}/${p.total} việc xong`));
    } else sheet.append(el("small", "không có checklist"));
    sheet.append(el("small", ago(p.at, ctx.now()), "when"));
    root.append(sheet);
  });
  return root;
}

// ---- sổ migration: a timeline ----
function ledger(d: Extract<BuildingData, { id: "database" }>, ctx: BuildingCtx): HTMLElement {
  if (!d.repos.length) return empty("Không thấy thư mục migrations nào");
  const root = el("div", undefined, "bd bd-ledger");
  for (const r of d.repos) {
    root.append(el("h3", r.repo));
    const line = el("ol");
    for (const m of r.items) {
      const li = el("li");
      const fresh = ctx.now() - Date.parse(m.at) < 86_400_000;
      if (fresh) li.className = "fresh";
      li.append(el("b", m.name.replace(/\.[a-z]+$/i, "")), el("small", ago(m.at, ctx.now())));
      if (fresh) li.append(el("span", "mới", "tag"));
      line.append(li);
    }
    root.append(line);
  }
  return root;
}

/** One department's board, each drawn its own way. */
export function renderBuilding(d: BuildingData, ctx: BuildingCtx): HTMLElement {
  switch (d.id) {
    case "townhall": return inbox(d, ctx);
    case "home": return lounge(d, ctx);
    case "site": return wall(d);
    case "lab": return tubes(d, ctx);
    case "factory": return belt(d, ctx);
    case "airport": return departures(d, ctx);
    case "watchtower": return radar(d, ctx);
    case "library": return shelf(d);
    case "design": return papers(d, ctx);
    case "database": return ledger(d, ctx);
  }
}

/** The dialog of a department: loads its data, with Làm mới to skip the server's cache. */
export function renderBuildingDialog(id: BuildingId, load: (fresh: boolean) => Promise<BuildingData>, ctx: BuildingCtx): HTMLElement {
  const body = el("div");
  const refresh = el("button", "Làm mới", "go");
  refresh.type = "button";
  const root = frame(TITLES[id], refresh, body);
  root.classList.add("wide", `bd-${id}`);
  const show = async (fresh: boolean) => {
    body.replaceChildren(el("div", "Đang tải…", "msg"));
    refresh.disabled = true;
    try {
      body.replaceChildren(renderBuilding(await load(fresh), { ...ctx, chat: (sid) => (root.remove(), ctx.chat(sid)) }));
    } catch {
      body.replaceChildren(el("div", "Không tải được", "msg"));
    } finally {
      refresh.disabled = false;
    }
  };
  refresh.onclick = () => void show(true);
  void show(false);
  return root;
}
