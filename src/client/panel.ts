import { districtInfo } from "../shared/districts.js";
import type { Delta, Employee, EmployeeDetail, SessionDetail, Session, ToolStep, TokenCounts } from "../shared/types.js";

export type Kind = "session" | "employee";
export type Detail = SessionDetail | EmployeeDetail;

const STATUS_LABEL: Record<Session["status"] | Employee["status"], string> = { working: "Đang làm", waiting: "Chờ bạn", idle: "Nghỉ", done: "Xong" };
const TRUNC_NOTE = "(đã rút gọn — xem đầy đủ trong transcript)";
const SESSION_STEPS = 20;
const REFETCH_MS = 1000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} giây`;
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
}

const badge = (status: keyof typeof STATUS_LABEL) => el("span", STATUS_LABEL[status], `badge ${status}`);
const clock = (iso: string) => (Number.isNaN(Date.parse(iso)) ? "—" : new Date(iso).toTimeString().slice(0, 8));

function heading(text: string) {
  return el("h3", text);
}

function stepRows(steps: ToolStep[]): HTMLElement {
  const box = el("div", undefined, "steps");
  for (const s of steps) {
    const row = el("div", undefined, "step");
    row.style.overflowWrap = "anywhere";
    const d = s.district ? districtInfo(s.district).label : "—";
    row.textContent = `${clock(s.at)} · ${d} · ${s.name} ${s.summary}`;
    box.append(row);
  }
  return box;
}

function note(text: string) {
  return text.endsWith("…") ? el("div", TRUNC_NOTE, "note") : null;
}

function tokenTable(t: { byModel: Record<string, TokenCounts> } & TokenCounts): HTMLElement {
  const table = el("table", undefined, "tokens");
  const row = (label: string, c: TokenCounts, tag: "th" | "td" = "td") => {
    const tr = el("tr");
    tr.append(el("th", label), ...[c.input, c.output, c.cacheRead + c.cacheWrite].map((n) => el(tag, n.toLocaleString("en-US"))));
    table.append(tr);
  };
  const head = el("tr");
  head.append(el("th", "Model"), el("th", "Vào"), el("th", "Ra"), el("th", "Cache"));
  table.append(head);
  for (const [m, c] of Object.entries(t.byModel)) row(m, c);
  row("Tổng", t);
  return table;
}

export function renderSession(d: SessionDetail, now: number, onPickEmployee: (id: string) => void): HTMLElement {
  const root = el("div", undefined, "detail");
  const head = el("div", undefined, "d-head");
  head.append(el("h2", d.project));
  const meta = el("div", undefined, "meta");
  meta.append(badge(d.status), ` ${[d.branch, d.model].filter(Boolean).join(" · ")} · ${ago(now - Date.parse(d.lastActivity))}`);
  head.append(meta);
  root.append(head);

  const det = el("details");
  det.open = true;
  det.append(el("summary", "Yêu cầu gần nhất"), el("pre", d.lastPrompt ?? "—"));
  const pn = note(d.lastPrompt ?? "");
  if (pn) det.append(pn);
  root.append(det, heading("Token"), tokenTable(d.tokens), heading("Nhân viên"));

  const staff = [...d.staff].sort((a, b) => Number(b.status === "working") - Number(a.status === "working"));
  if (!staff.length) root.append(el("div", "—", "muted"));
  for (const e of staff) {
    const row = el("button", undefined, "staff-row");
    row.type = "button";
    row.dataset.employee = e.id;
    const end = e.endedAt ? Date.parse(e.endedAt) : now;
    row.append(badge(e.status), ` ${e.type} · ${e.description} · ${duration(end - Date.parse(e.startedAt))}`);
    row.onclick = () => onPickEmployee(e.id);
    root.append(row);
  }

  root.append(heading("Hoạt động gần đây"), stepRows(d.steps.slice(0, SESSION_STEPS)));
  return root;
}

export function renderEmployee(d: EmployeeDetail, now: number, onBack: () => void): HTMLElement {
  const root = el("div", undefined, "detail");
  const back = el("button", "← Trụ sở", "back");
  back.type = "button";
  back.onclick = onBack;
  const head = el("div", undefined, "d-head");
  head.append(el("h2", d.type), el("div", d.description, "meta"));
  const meta = el("div", undefined, "meta");
  const end = d.endedAt ? Date.parse(d.endedAt) : now;
  meta.append(badge(d.status), ` ${duration(end - Date.parse(d.startedAt))}${d.models.length ? " · " + d.models.join(", ") : ""}`);
  head.append(meta);
  root.append(back, head, heading("Thị trưởng giao việc"), el("pre", d.prompt));
  const pn = note(d.prompt);
  if (pn) root.append(pn);
  root.append(heading("Các bước đã làm"), stepRows(d.steps.slice(0, 100)), heading("Báo cáo lại"));
  if (d.report === undefined) root.append(el("div", "Đang làm…", "muted"));
  else {
    root.append(el("pre", d.report));
    const rn = note(d.report);
    if (rn) root.append(rn);
  }
  return root;
}

export class Panel {
  private cur: { kind: Kind; id: string } | null = null;
  private seq = 0;
  private lastFetch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private banner = el("div", undefined, "banner");
  private body = el("div", undefined, "panel-body");

  constructor(private root: HTMLElement, private fetchDetail: (kind: Kind, id: string) => Promise<Detail | "gone">) {
    const close = el("button", "✕", "close");
    close.type = "button";
    close.setAttribute("aria-label", "Đóng");
    close.onclick = () => this.close();
    this.banner.hidden = true;
    root.replaceChildren(close, this.banner, this.body);
    root.hidden = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || root.hidden) return;
      this.close();
      e.stopImmediatePropagation(); // panel first, then scene
    });
  }

  async open(kind: Kind, id: string): Promise<void> {
    this.cur = { kind, id };
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.banner.hidden = true;
    this.body.replaceChildren();
    this.root.hidden = false;
    await this.refresh();
  }

  close() {
    this.cur = null;
    this.seq++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.root.hidden = true;
  }

  onDelta(d: Delta) {
    const c = this.cur;
    if (!c || this.timer) return;
    const hit = d.removed.includes(c.id) || (c.kind === "session" ? d.sessions : d.employees).some((x) => x.id === c.id);
    if (!hit) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, Math.max(0, this.lastFetch + REFETCH_MS - Date.now()));
  }

  private async refresh() {
    const c = this.cur;
    if (!c) return;
    const mine = ++this.seq;
    this.lastFetch = Date.now();
    let res: Detail | "gone";
    try {
      res = await this.fetchDetail(c.kind, c.id);
    } catch {
      return; // keep content silently
    }
    if (mine !== this.seq) return;
    if (res === "gone") {
      this.banner.textContent = c.kind === "session" ? "Phiên này đã kết thúc" : "Nhân viên này đã kết thúc";
      this.banner.hidden = false;
      return;
    }
    this.banner.hidden = true;
    const top = this.body.scrollTop;
    const wasOpen = this.body.querySelector("details")?.open; // undefined on first render of this actor → default open
    const now = Date.now();
    this.body.replaceChildren(
      c.kind === "session"
        ? renderSession(res as SessionDetail, now, (id) => void this.open("employee", id))
        : renderEmployee(res as EmployeeDetail, now, () => void this.open("session", (res as EmployeeDetail).sessionId)),
    );
    const det = this.body.querySelector("details");
    if (det && wasOpen !== undefined) det.open = wasOpen;
    this.body.scrollTop = top;
  }
}
