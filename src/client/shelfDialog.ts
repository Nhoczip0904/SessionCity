import type { Employee, PrRow, RepoPrs, Session, Shelf } from "../shared/types.js";
import { el, frame } from "./launcher.js";
import type { tokenRows } from "./rooms.js";

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const SCOPE = { user: "của bạn", project: "dự án", local: "local" };

function button(text: string, cls: string, onclick: () => void): HTMLButtonElement {
  const b = el("button", text, cls);
  b.type = "button";
  b.onclick = onclick;
  return b;
}

export function renderTokenDialog(rows: ReturnType<typeof tokenRows>): HTMLElement {
  if (!rows) return frame("Két token", el("div", "Chưa dùng token nào", "msg"));
  const table = el("table");
  const line = (cells: string[], tag: "th" | "td") => {
    const tr = el("tr");
    for (const c of cells) tr.append(el(tag, c));
    table.append(tr);
  };
  line(["Model", "Input", "Output", "Cache đọc", "Cache ghi"], "th");
  for (const r of rows.rows) line(r, "td");
  line(rows.total, "td");
  return frame("Két token", table, el("div", `Trong đó nhân viên: ${rows.staff.toLocaleString("vi-VN")} token`, "note"));
}

export function renderFilesDialog(list: Employee[], onPick: (id: string) => void): HTMLElement {
  if (!list.length) return frame("Hồ sơ", el("div", "Chưa có báo cáo nào", "msg"));
  const root = frame("Hồ sơ", ...list.map((e) => button(`${e.type} — ${e.description} — ${hhmm(e.endedAt)}`, "row", () => {
    onPick(e.id);
    root.remove();
  })));
  return root;
}

export function renderShelfDialog(load: () => Promise<Shelf>, read: (id: string) => Promise<{ text: string; truncated: boolean }>, reveal?: (id: string) => void): HTMLElement {
  const body = el("div");
  const root = frame("Kệ sách", body);
  let shelf: Shelf | null = null;
  const list = () => {
    body.replaceChildren();
    if (!shelf!.files.length && !shelf!.skills.length) return void body.append(el("div", "Không thấy file hay skill nào", "msg"));
    body.append(el("h3", "File nạp sẵn"));
    for (const f of shelf!.files) {
      const line = el("div", undefined, "frow");
      line.append(button(`${SCOPE[f.scope]} — ${f.path}`, "row", () => open(f.id)));
      if (reveal) {
        const r = button("Mở", "reveal", () => reveal(f.id));
        r.title = "Hiện file trong Explorer";
        line.append(r);
      }
      body.append(line);
    }
    body.append(el("h3", "Skill"));
    for (const s of shelf!.skills) {
      const scope = s.scope === "plugin" ? `plugin ${s.plugin ?? ""}`.trim() : SCOPE[s.scope];
      body.append(button(`${s.name} — ${scope}${s.used ? " — đã dùng" : ""}${s.description ? ` — ${s.description}` : ""}`, "row", () => open(s.id)));
    }
  };
  const open = async (id: string) => {
    body.replaceChildren(el("div", "Đang tải…", "msg"));
    let r;
    try {
      r = await read(id);
    } catch {
      r = { text: "Không đọc được", truncated: false };
    }
    const pre = el("pre", r.text);
    body.replaceChildren(button("← Kệ sách", "go", list), pre);
    if (r.truncated) body.append(el("div", "Đã cắt ở 64 KB", "note"));
  };
  body.append(el("div", "Đang tải…", "msg"));
  load().then((s) => {
    shelf = s;
    list();
  }, () => body.replaceChildren(el("div", "Không tải được kệ sách", "msg")));
  return root;
}

const REVIEW: Record<NonNullable<PrRow["review"]>, [string, string]> = { approved: ["Đã duyệt", "ok"], changes: ["Cần sửa", "bad"], pending: ["Chờ review", "wait"] };
const CI: Record<NonNullable<PrRow["ci"]>, [string, string]> = { pass: ["CI ✓", "ok"], fail: ["CI ✗", "bad"], pending: ["CI ⏳", "wait"] };

/** One PR line: a link to GitHub when the server vouched for the URL, plain text otherwise. */
function prLine(p: PrRow, sessions: Session[]): HTMLElement {
  const line = p.url ? el("a", undefined, "pr") : el("div", undefined, "pr");
  if (line instanceof HTMLAnchorElement) {
    line.href = p.url!;
    line.target = "_blank";
    line.rel = "noopener noreferrer";
  }
  const meta = el("div", undefined, "meta");
  meta.append(el("span", `👤 ${p.author ?? "?"}`, "who"));
  const tags: [string, string][] = [];
  if (p.draft) tags.push(["Draft", "draft"]);
  if (p.conflict) tags.push(["Xung đột", "bad"]);
  tags.push(p.review ? REVIEW[p.review] : ["Chưa review", "none"], p.ci ? CI[p.ci] : ["Chưa có CI", "none"]);
  for (const [text, cls] of tags) meta.append(" ", el("span", text, `tag ${cls}`));
  line.append(el("span", `#${p.number}`, "num"), " ", el("span", p.title, "t"), meta);
  // shortcut: matched by branch name alone, so two repos with the same branch name would both show it
  if (p.branch) for (const s of sessions) if (s.branch === p.branch) meta.append(" ", el("span", `💬 ${s.title || s.project}`, "sess"));
  return line;
}

/**
 * The PR board, a panel pinned to the main screen: open PRs of the repos the sessions work in.
 * Làm mới skips the server's cache; while on the page it also reloads by itself every `everyMs`, keeping the list up.
 */
export function renderPrBoard(load: (fresh: boolean) => Promise<RepoPrs[]>, everyMs = 20_000, sessions: () => Session[] = () => []): HTMLElement {
  const body = el("div", undefined, "body");
  const refresh = button("Làm mới", "refresh", () => void show(true));
  const fold = button("▾", "fold", () => {
    const folded = root.classList.toggle("folded");
    fold.textContent = folded ? "▸" : "▾";
    fold.setAttribute("aria-expanded", String(!folded));
  });
  fold.title = "Thu gọn hoặc mở bảng PR";
  fold.setAttribute("aria-expanded", "true");
  const root = el("aside", undefined, "");
  root.id = "prs";
  root.append(el("div", undefined, "bar"), body);
  root.firstElementChild!.append(fold, el("b", "Bảng PR"), refresh);
  const show = async (fresh: boolean, quiet = false) => {
    if (!quiet) body.replaceChildren(el("div", "Đang tải…", "msg"));
    refresh.disabled = true;
    try {
      const repos = await load(fresh);
      const top = body.scrollTop; // a redraw must not throw the reader back to the top
      body.replaceChildren();
      if (!repos.length) body.append(el("div", "Chưa có session nào trong repo git", "msg"));
      for (const r of repos) {
        const h = el("h3", r.url ? "" : r.repo);
        if (r.url) {
          const a = document.createElement("a");
          a.href = r.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = r.repo;
          h.append(a);
        }
        body.append(h);
        if (r.error) body.append(el("div", r.error, "note"));
        else if (!r.prs.length) body.append(el("div", "Không có PR đang mở", "note"));
        else body.append(...r.prs.map((p) => prLine(p, sessions())));
      }
      body.scrollTop = top;
    } catch {
      if (!quiet) body.replaceChildren(el("div", "Không tải được danh sách PR", "msg"));
    } finally {
      refresh.disabled = false;
    }
  };
  void show(false);
  // shortcut: never cleared, the board lives as long as the page
  setInterval(() => root.isConnected && !document.hidden && void show(false, true), everyMs);
  document.addEventListener("visibilitychange", () => root.isConnected && !document.hidden && void show(false, true));
  return root;
}
