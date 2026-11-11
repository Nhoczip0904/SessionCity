import type { Container } from "pixi.js";
import type { Delta, District, SessionDetail } from "../shared/types.js";

export type Place = { kind: "city" } | { kind: "room"; district: District } | { kind: "office"; sessionId: string };
type Inside = Exclude<Place, { kind: "city" }>;

export interface SceneDeps {
  mount: Container;
  draw(place: Inside, detail: SessionDetail | null, error: boolean): Container;
  fetchSession(id: string): Promise<SessionDetail | "gone">;
  /** What `draw` would show; an unchanged key skips the redraw so taps and hover survive busy deltas. */
  key?(place: Inside, detail: SessionDetail | null, error: boolean): string;
  onChange(place: Place): void;
}

const REFETCH_MS = 1000;
const RETRY_MS = 3000;

export class Scene {
  place: Place = { kind: "city" };
  private room: Container | null = null;
  private detail: SessionDetail | null = null;
  private error = false;
  private shownKey: string | null = null;
  private seq = 0;
  private lastFetch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.place.kind !== "city") this.exit();
  };

  constructor(private deps: SceneDeps) {
    document.addEventListener("keydown", this.onKey);
  }

  dispose() {
    document.removeEventListener("keydown", this.onKey);
  }

  enter(p: Place) {
    if (p.kind === "city") return this.exit();
    this.seq++;
    this.clearTimer();
    this.place = p;
    this.detail = null;
    this.error = false;
    this.shownKey = null;
    this.show();
    this.deps.onChange(p);
    if (p.kind === "office") void this.refresh(p.sessionId);
  }

  exit() {
    this.seq++;
    this.clearTimer();
    this.place = { kind: "city" };
    this.detail = null;
    this.error = false;
    this.room?.destroy({ children: true });
    this.room = null;
    this.shownKey = null;
    this.deps.onChange(this.place);
  }

  redraw() {
    if (this.place.kind !== "city") this.show();
  }

  onDelta(d: Delta) {
    const p = this.place;
    if (p.kind !== "office") return;
    const id = p.sessionId;
    if (d.removed.includes(id)) return this.exit();
    if (this.timer || !(d.sessions.some((s) => s.id === id) || d.employees.some((e) => e.sessionId === id))) return;
    this.schedule(id, Math.max(0, this.lastFetch + REFETCH_MS - Date.now()));
  }

  private show() {
    if (this.place.kind === "city") return;
    const key = this.deps.key?.(this.place, this.detail, this.error) ?? null;
    if (key !== null && key === this.shownKey && this.room) return;
    this.shownKey = key;
    const next = this.deps.draw(this.place, this.detail, this.error);
    this.room?.destroy({ children: true });
    this.room = next;
    this.deps.mount.addChild(next);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(id: string, ms: number) {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh(id);
    }, ms);
  }

  private async refresh(id: string) {
    const mine = ++this.seq;
    this.lastFetch = Date.now();
    let res: SessionDetail | "gone";
    try {
      res = await this.deps.fetchSession(id);
    } catch {
      if (mine !== this.seq) return;
      this.error = true;
      this.show();
      this.clearTimer();
      this.schedule(id, RETRY_MS);
      return;
    }
    if (mine !== this.seq) return;
    if (res === "gone") return this.exit();
    this.detail = res;
    this.error = false;
    this.show();
  }
}
