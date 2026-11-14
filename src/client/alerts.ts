import type { AskRow, Session } from "../shared/types.js";

/** A session holding a permission question needs the user even while its transcript says it is working: show it as waiting. */
export function withAsks(sessions: Session[], asks: AskRow[]): Session[] {
  const asked = new Set(asks.map((a) => a.session));
  return sessions.map((s) => (asked.has(s.id) && s.status !== "waiting" ? { ...s, status: "waiting" } : s));
}

export interface AlertEnv {
  /** true when the page is hidden or unfocused: nobody is looking at the city */
  away(): boolean;
  notify(title: string, body: string, click: () => void): void;
  title(text: string): void;
}

/** Tells the user when a session starts needing them: the tab title always, a notification while they are away. */
export class Alerts {
  private seen: Set<string> | null = null; // null until the first update: sessions already waiting at load are not news

  constructor(private env: AlertEnv, private base: string) {}

  /** A one-off piece of news: a notification, but only while the user is away from the page. */
  tell(title: string, body: string, click: () => void): void {
    if (this.env.away()) this.env.notify(title, body, click);
  }

  update(sessions: Session[], asks: AskRow[], click: (sessionId: string) => void): void {
    const waiting = sessions.filter((s) => s.status === "waiting");
    const fresh = this.seen ? waiting.filter((s) => !this.seen!.has(s.id)) : [];
    this.seen = new Set(waiting.map((s) => s.id));
    this.env.title(waiting.length ? `(${waiting.length}) ! Chờ bạn · ${this.base}` : this.base);
    if (!this.env.away()) return;
    for (const s of fresh) {
      const q = asks.find((a) => a.session === s.id);
      this.env.notify(`${s.title || s.project} cần bạn`, q ? `Xin quyền ${q.tool}: ${q.summary}` : "Claude xong lượt, đang chờ bạn trả lời", () => click(s.id));
    }
  }
}
