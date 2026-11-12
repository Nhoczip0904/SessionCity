import type { Employee, Session } from "../shared/types.js";

const ORDER: Record<Session["status"], number> = { working: 0, waiting: 1, idle: 2 };
const STATUS_TEXT: Record<Session["status"] | Employee["status"], string> = { working: "Đang làm", waiting: "Chờ bạn", idle: "Nghỉ", done: "Xong" };

/** The index down the left edge: main agents (sessions), each with its subagents folded under a +N button. */
export class AgentList {
  private open = new Set<string>(); // sessions whose subagents are shown
  private last: [Session[], Employee[]] = [[], []];

  constructor(
    private root: HTMLElement,
    private pick: (kind: "session" | "employee", id: string) => void,
    private avatarOf: (sessionId: string) => string | null = () => null,
  ) {
    root.onclick = (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-toggle], [data-pick]");
      if (!el) return;
      if (el.dataset.toggle) {
        const id = el.dataset.toggle;
        if (!this.open.delete(id)) this.open.add(id);
        this.render(...this.last);
      } else {
        const [kind, id] = el.dataset.pick!.split(":") as ["session" | "employee", string];
        this.pick(kind, id);
      }
    };
  }

  render(sessions: Session[], employees: Employee[]): void {
    this.last = [sessions, employees];
    const sorted = [...sessions].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.lastActivity.localeCompare(a.lastActivity));
    const list = document.createElement("ul");
    for (const s of sorted) {
      const li = document.createElement("li");
      const cell = document.createElement("div"); // the tile and its +N corner button
      cell.className = "agent-cell";
      cell.append(row(`session:${s.id}`, s.status, s.title || s.project, this.avatarOf(s.id)));
      li.append(cell);
      const subs = employees.filter((e) => e.sessionId === s.id);
      if (subs.length) {
        const shown = this.open.has(s.id);
        const t = document.createElement("button");
        t.type = "button";
        t.className = "agent-toggle";
        t.dataset.toggle = s.id;
        t.textContent = shown ? "−" : `+${subs.length}`;
        t.setAttribute("aria-expanded", String(shown));
        t.setAttribute("aria-label", `${shown ? "Ẩn" : "Hiện"} ${subs.length} subagent`);
        cell.append(t);
        if (shown) {
          li.className = "open"; // takes the whole grid row so its subagent tiles fit under it
          const ul = document.createElement("ul");
          for (const e of subs) {
            const sub = document.createElement("li");
            sub.append(row(`employee:${e.id}`, e.status, `${e.type} — ${e.description}`));
            ul.append(sub);
          }
          li.append(ul);
        }
      }
      list.append(li);
    }
    // live updates rebuild the list: keep keyboard focus on the same row or button
    const f = this.root.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const key = f?.dataset.toggle ? `[data-toggle="${CSS.escape(f.dataset.toggle)}"]` : f?.dataset.pick ? `[data-pick="${CSS.escape(f.dataset.pick)}"]` : null;
    this.root.replaceChildren(list);
    if (key) this.root.querySelector<HTMLElement>(key)?.focus();
  }
}

/** One clickable line; `avatar` (main agents only) is an image URL, null for none. */
function row(pick: string, status: Session["status"] | Employee["status"], label: string, avatar?: string | null): HTMLButtonElement {
  const sub = avatar === undefined;
  const b = document.createElement("button");
  b.type = "button";
  b.className = sub ? "agent-row sub" : "agent-row";
  b.dataset.pick = pick;
  b.title = `${label} — ${STATUS_TEXT[status]}`;
  const dot = document.createElement("span");
  dot.className = `st ${status}`;
  dot.setAttribute("aria-label", STATUS_TEXT[status]);
  const text = document.createElement("span");
  text.className = "name";
  text.textContent = label;
  b.append(dot);
  if (avatar) {
    const img = document.createElement("img");
    img.className = "ava";
    img.src = avatar;
    img.alt = ""; // the name next to it says who this is
    b.append(img);
  } else if (!sub) {
    const gap = document.createElement("span"); // keeps names in line when a figure is not on the map yet
    gap.className = "ava";
    b.append(gap);
  }
  b.append(text);
  return b;
}
