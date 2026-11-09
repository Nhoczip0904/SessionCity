import type { Delta, Employee, Event, Session, State, TokenCounts, Tokens } from "../shared/types.js";

const MAX = 4096;
const IDLE_MS = 10 * 60_000;
const HIDE_MS = 24 * 60 * 60_000;
const DONE_MS = 30_000;

const cut = (s: string) => (s.length > MAX ? s.slice(0, MAX) + "…" : s);
const zero = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const emptyTokens = (): Tokens => ({ ...zero(), byModel: {} });
const add = (a: TokenCounts, b: TokenCounts) => {
  a.input += b.input; a.output += b.output; a.cacheRead += b.cacheRead; a.cacheWrite += b.cacheWrite;
};
const addUsage = (t: Tokens, model: string, u: TokenCounts) => {
  add(t, u);
  add((t.byModel[model] ??= zero()), u);
};

interface Pending { sessionId: string; type: string; description: string; prompt: string }

export class Store {
  private sessions = new Map<string, Session>();
  private employees = new Map<string, Employee>();
  private lastEvent = new Map<string, number>(); // sessionId -> now() ms
  private endedAt = new Map<string, number>(); // agentId -> now() ms
  private pending = new Map<string, Pending>(); // toolUseId -> spawn info
  private seen = new Map<string, Set<string>>(); // sessionId -> counted messageIds
  private dirtyS = new Set<string>();
  private dirtyE = new Set<string>();
  private removed: string[] = [];

  constructor(private now: () => number = Date.now) {}

  private session(id: string, at?: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id, project: id.slice(0, 8), cwd: "", lastActivity: new Date(this.ms(at)).toISOString(),
        status: "waiting", district: "townhall", tokens: emptyTokens(), employees: [],
      };
      this.sessions.set(id, s);
      this.lastEvent.set(id, this.ms(at));
      this.dirtyS.add(id);
    }
    return s;
  }

  private employee(sessionId: string, agentId: string, at: string): Employee {
    let e = this.employees.get(agentId);
    if (!e) {
      const s = this.session(sessionId);
      e = {
        id: agentId, sessionId, type: "unknown", description: "", prompt: "", toolUseId: "",
        status: "working", district: s.district, startedAt: at, tokens: emptyTokens(),
      };
      this.employees.set(agentId, e);
      s.employees.push(agentId);
      this.dirtyS.add(sessionId);
    }
    this.dirtyE.add(agentId);
    return e;
  }

  /** Event time clamped to now(); now() when missing/invalid. */
  private ms(at?: string): number {
    const p = at ? Date.parse(at) : NaN;
    return Number.isFinite(p) ? Math.min(p, this.now()) : this.now();
  }

  private activity(s: Session, at: string) {
    const m = this.ms(at);
    if (m > (this.lastEvent.get(s.id) ?? 0)) {
      this.lastEvent.set(s.id, m);
      s.lastActivity = new Date(m).toISOString();
    }
    this.dirtyS.add(s.id);
  }

  apply(e: Event): void {
    const s = this.session(e.sessionId, e.at);
    if (e.kind === "meta") {
      let changed = false;
      const set = <K extends "title" | "branch" | "cwd">(k: K, v: string | undefined) => {
        if (v === undefined) return;
        const c = cut(v);
        if (s[k] !== c) { s[k] = c; changed = true; }
      };
      set("title", e.title); set("branch", e.branch); set("cwd", e.cwd);
      const p = s.cwd.split(/[/\\]/).filter(Boolean).pop() ?? s.id.slice(0, 8);
      if (s.project !== p) { s.project = p; changed = true; }
      if (changed) this.dirtyS.add(s.id);
      return;
    }
    this.activity(s, e.at);
    switch (e.kind) {
      case "prompt":
        s.status = "working"; s.district = "townhall";
        break;
      case "tool":
        s.status = "working";
        if (e.agentId) {
          const emp = this.employee(e.sessionId, e.agentId, e.at);
          if (e.district) emp.district = e.district;
        } else if (e.district) s.district = e.district;
        break;
      case "spawn": {
        s.status = "working";
        const p: Pending = { sessionId: e.sessionId, type: cut(e.type), description: cut(e.description), prompt: cut(e.prompt) };
        const emp = [...this.employees.values()].find((x) => x.toolUseId === e.toolUseId && e.toolUseId !== "");
        if (emp) {
          emp.prompt = p.prompt;
          if (!emp.description) emp.description = p.description;
          if (emp.type === "unknown") emp.type = p.type;
          this.dirtyE.add(emp.id);
        } else this.pending.set(e.toolUseId, p);
        break;
      }
      case "agentMeta": {
        const emp = this.employee(e.sessionId, e.agentId, e.at);
        const p = this.pending.get(e.toolUseId);
        this.pending.delete(e.toolUseId);
        emp.toolUseId = e.toolUseId;
        emp.type = cut(e.type);
        emp.description = cut(e.description) || p?.description || emp.description;
        emp.prompt = p?.prompt ?? emp.prompt;
        break;
      }
      case "report": {
        const emp = [...this.employees.values()].find((x) => x.toolUseId === e.toolUseId && e.toolUseId !== "");
        if (emp && emp.status !== "done") {
          emp.status = "done"; emp.endedAt = e.at;
          this.endedAt.set(emp.id, this.now());
          this.dirtyE.add(emp.id);
        }
        break;
      }
      case "turnEnd":
        if (e.agentId) this.employee(e.sessionId, e.agentId, e.at);
        else { s.status = "waiting"; s.district = "townhall"; }
        break;
      case "usage": {
        if (e.messageId !== "") {
          let ids = this.seen.get(e.sessionId);
          if (!ids) this.seen.set(e.sessionId, (ids = new Set()));
          if (ids.has(e.messageId)) return;
          ids.add(e.messageId);
        }
        addUsage(s.tokens, e.model, e.usage);
        if (e.agentId) addUsage(this.employee(e.sessionId, e.agentId, "").tokens, e.model, e.usage);
        else s.model = cut(e.model);
        break;
      }
    }
  }

  tick(): void {
    const now = this.now();
    for (const [id, s] of [...this.sessions]) {
      const age = now - (this.lastEvent.get(id) ?? now);
      if (age >= HIDE_MS) {
        for (const a of s.employees) this.dropEmployee(a, false);
        this.sessions.delete(id); this.lastEvent.delete(id); this.dirtyS.delete(id);
        this.seen.delete(id);
        for (const [k, p] of this.pending) if (p.sessionId === id) this.pending.delete(k);
        this.removed.push(id);
      } else if (age >= IDLE_MS && s.status !== "idle") {
        s.status = "idle"; s.district = "home";
        this.dirtyS.add(id);
        for (const a of s.employees) {
          const emp = this.employees.get(a);
          if (emp && emp.status === "working") {
            emp.status = "done"; emp.endedAt = new Date(now).toISOString();
            this.endedAt.set(a, now);
            this.dirtyE.add(a);
          }
        }
      }
    }
    for (const [a, at] of [...this.endedAt]) if (now - at >= DONE_MS) this.dropEmployee(a, true);
  }

  private dropEmployee(id: string, detach: boolean) {
    const e = this.employees.get(id);
    if (!e) return;
    this.employees.delete(id); this.endedAt.delete(id); this.dirtyE.delete(id);
    this.removed.push(id);
    if (detach) {
      const s = this.sessions.get(e.sessionId);
      if (s) { s.employees = s.employees.filter((x) => x !== id); this.dirtyS.add(s.id); }
    }
  }

  snapshot(): State {
    return {
      sessions: structuredClone([...this.sessions.values()]),
      employees: structuredClone([...this.employees.values()]),
    };
  }

  drainDelta(): Delta | null {
    if (!this.dirtyS.size && !this.dirtyE.size && !this.removed.length) return null;
    const d: Delta = {
      sessions: structuredClone([...this.dirtyS].map((i) => this.sessions.get(i)!).filter(Boolean)),
      employees: structuredClone([...this.dirtyE].map((i) => this.employees.get(i)!).filter(Boolean)),
      removed: this.removed,
    };
    this.dirtyS.clear(); this.dirtyE.clear(); this.removed = [];
    return d;
  }
}
