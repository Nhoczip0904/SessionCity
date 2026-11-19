import type { PrInfo, Session } from "../shared/types.js";
import { el } from "./launcher.js";

/** Dragging a session from the menu carries its id under this type; a chat box takes it. */
export const SESSION_DRAG = "application/x-city-session";

const HIDDEN_KEY = "city.hiddenSessions";
const hiddenIds = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
};
const setHidden = (ids: Set<string>) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids])); } catch { /* private mode: hidden until reload */ } };

let loadPrs: (sessionId: string) => Promise<PrInfo[]> = async () => [];
/** Where the badge popup gets a session's PRs (the page knows the token). */
export function setPrLoader(f: (sessionId: string) => Promise<PrInfo[]>): void { loadPrs = f; }

const STATE_LABEL = { open: "Đang mở", merged: "Đã hợp nhất", closed: "Đã đóng" };
let pop: HTMLElement | null = null;
const closePop = () => { pop?.remove(); pop = null; };
/** Popup under `anchor` listing a session's PRs; a second click on the same badge closes it. */
async function togglePop(anchor: HTMLElement, sessionId: string): Promise<void> {
  const again = pop?.dataset.for === sessionId;
  closePop();
  if (again) return;
  const list = await loadPrs(sessionId).catch(() => []);
  if (!anchor.isConnected || pop) return; // menu redrew or another popup won meanwhile
  const p = (pop = el("div", undefined, "pr-pop"));
  p.dataset.for = sessionId;
  if (!list.length) p.append(el("div", "Không lấy được PR", "pr-row"));
  for (const x of list) {
    const row = el("div", undefined, "pr-row");
    const t = el("a", x.title || `PR #${x.number}`, "pr-title");
    t.href = x.url;
    t.target = "_blank";
    t.rel = "noopener noreferrer";
    row.append(t);
    const meta = el("div", undefined, "pr-meta");
    meta.append(el("span", x.state ? STATE_LABEL[x.state] : "?", `pr-state ${x.state ?? ""}`), el("span", `${x.repo} #${x.number}`));
    if (x.additions || x.deletions) meta.append(el("span", `+${x.additions}`, "pr-add"), el("span", `−${x.deletions}`, "pr-del"));
    row.append(meta);
    p.append(row);
  }
  document.body.append(p);
  const r = anchor.getBoundingClientRect();
  p.style.left = `${Math.min(r.left, Math.max(0, innerWidth - 330))}px`;
  p.style.top = `${r.bottom + 4}px`;
  setTimeout(() => document.addEventListener("click", closePop, { once: true }), 0);
}

const live = new Map<HTMLElement, (sessions: Session[]) => void>(); // menus on the page, each knowing how to redraw itself
let dragging = false;
let openIds = new Set<string>(); // sessions with a chat window open: their rows get an orange border
/** Called by the chat whenever a window opens or closes. */
export function markOpen(ids: string[]): void {
  openIds = new Set(ids);
  document.querySelectorAll<HTMLElement>(".chat-pick[data-id]").forEach((r) => (r.dataset.open = openIds.has(r.dataset.id!) ? "true" : ""));
}
let latest: Session[] = []; // what the menus last drew, for a redraw after (un)hiding

/** Redraw every menu still on the page with the latest sessions (called on each live update). */
export function refreshMenus(sessions: Session[]): void {
  latest = sessions;
  for (const [root, fill] of live) {
    if (!root.isConnected) live.delete(root);
    else if (!dragging) fill(sessions); // a redraw would drop the row being dragged
  }
}

/** The sessions beside the chat, grouped by folder (newest group and session first); the open one is marked. */
export function sessionMenu(
  sessions: Session[],
  current: string,
  avatarOf: (id: string) => string | null,
  pick: (id: string) => void,
): HTMLElement {
  const root = el("div", undefined, "chat-side");
  let showHidden = false;
  const fill = (sessions: Session[]) => {
    const groups = new Map<string, Session[]>();
    const hidden = hiddenIds();
    if (!hidden.size) showHidden = false; // nothing left to show
    const nHidden = sessions.filter((s) => hidden.has(s.id) && s.id !== current).length;
    for (const s of [...sessions].filter((s) => showHidden || s.id === current || !hidden.has(s.id)).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))) {
      const g = groups.get(s.cwd);
      if (g) g.push(s);
      else groups.set(s.cwd, [s]); // insertion order = most recently active first
    }
    root.replaceChildren();
    for (const list of groups.values()) {
      root.append(el("h4", list[0].project));
      for (const s of list) {
        const b = el("button", undefined, "chat-pick");
        b.type = "button";
        b.dataset.id = s.id;
        b.draggable = true;
        b.addEventListener("dragstart", (e) => {
          e.dataTransfer?.setData(SESSION_DRAG, s.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          dragging = true;
          for (const t of ["dragend", "drop"]) document.addEventListener(t, () => void (dragging = false), { once: true, capture: true });
        });
        if (s.id === current) b.setAttribute("aria-current", "true");
        if (openIds.has(s.id)) b.dataset.open = "true";
        const dot = el("span", undefined, `st ${s.status}`);
        const ava = avatarOf(s.id);
        b.append(dot);
        if (ava) {
          const img = el("img", undefined, "ava");
          img.src = ava;
          img.alt = ""; // the title next to it says who this is
          b.append(img);
        } else b.append(el("span", undefined, "ava"));
        b.append(el("span", s.title || s.project, "name"));
        if (s.prs?.length) {
          const n = el("span", `🔀 ${s.prs.length}`, "prs");
          n.title = "Pull request của phiên này";
          n.addEventListener("click", (e) => { e.stopPropagation(); void togglePop(n, s.id); });
          b.append(n);
        }
        if (s.id !== current) {
          const x = el("span", hidden.has(s.id) ? "↩" : "×", "hide");
          x.title = hidden.has(s.id) ? "Hiện lại" : "Ẩn";
          x.addEventListener("click", (e) => {
            e.stopPropagation(); // not a pick
            const now = hiddenIds();
            if (!now.delete(s.id)) now.add(s.id);
            setHidden(now);
            for (const f of live.values()) f(latest);
          });
          b.append(x);
        }
        b.onclick = () => void (s.id !== current && pick(s.id));
        root.append(b);
      }
    }
    if (nHidden || showHidden && hidden.size) {
      const t = el("button", showHidden ? "Ẩn lại" : `Hiện ${nHidden} đã ẩn`, "show-hidden");
      t.type = "button";
      t.onclick = () => { showHidden = !showHidden; fill(latest); };
      root.append(t);
    }
  };
  latest = sessions;
  fill(sessions);
  live.set(root, fill);
  return root;
}
