import type { RepoPrs, Session } from "../shared/types.js";
import { ago } from "./buildings.js";
import { el } from "./launcher.js";

export interface DaySummary {
  /** sessions with activity today, newest first */
  today: Session[];
  working: number;
  waiting: number;
  idle: number;
  output: number;
  /** open pull requests and how many of them have failing CI; null when the list is not loaded */
  prs: { open: number; failing: number } | null;
}

const sameDay = (iso: string, now: number) => new Date(iso).toDateString() === new Date(now).toDateString();

/** What the day looks like from the sessions' state (and the PR list when there is one). */
export function summarize(sessions: Session[], now: number, prs: RepoPrs[] | null): DaySummary {
  const today = sessions.filter((s) => sameDay(s.lastActivity, now)).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  const count = (k: Session["status"]) => today.filter((s) => s.status === k).length;
  const open = prs?.flatMap((r) => r.prs) ?? [];
  return {
    today,
    working: count("working"),
    waiting: count("waiting"),
    idle: count("idle"),
    output: today.reduce((n, s) => n + s.tokens.output, 0),
    prs: prs ? { open: open.length, failing: open.filter((p) => p.ci === "fail").length } : null,
  };
}

const STATUS = { working: "đang làm", waiting: "chờ bạn", idle: "xong lượt" } as const;

export interface SummaryCtx { avatarOf(sessionId: string): string | null; now(): number; queued: number; open(sessionId: string): void }

export function renderSummary(s: DaySummary, ctx: SummaryCtx): HTMLElement {
  const root = el("div", undefined, "summary");
  if (!s.today.length) {
    root.append(el("div", "Hôm nay chưa có phiên nào hoạt động", "bd-empty"));
  } else {
    root.append(el("div", `${s.today.length} phiên · ${s.working} đang làm · ${s.waiting} chờ bạn · ${s.idle} xong lượt`, "sum-head"));
    root.append(el("div", `${s.output.toLocaleString("vi-VN")} token đầu ra`, "legend"));
  }
  const extra: string[] = [];
  if (s.prs) extra.push(`${s.prs.open} PR đang mở${s.prs.failing ? `, ${s.prs.failing} có CI lỗi` : ""}`);
  if (ctx.queued) extra.push(`${ctx.queued} việc đang xếp hàng`);
  if (extra.length) root.append(el("div", extra.join(" · "), "legend"));
  const group = (title: string, items: Session[]) => {
    if (!items.length) return;
    root.append(el("h3", title));
    for (const x of items) {
      const b = el("button", undefined, "sum-row");
      b.type = "button";
      const face = ctx.avatarOf(x.id);
      if (face) {
        const img = el("img");
        img.src = face;
        img.alt = "";
        b.append(img);
      }
      b.append(el("span", x.title || x.project, "name"), el("small", `${STATUS[x.status]} · ${ago(x.lastActivity, ctx.now())}`));
      b.onclick = () => ctx.open(x.id);
      root.append(b);
    }
  };
  group("Còn dang dở", s.today.filter((x) => x.status !== "idle"));
  group("Đã xong lượt", s.today.filter((x) => x.status === "idle"));
  return root;
}
