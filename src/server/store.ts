import type {
  ChatLine, Delta, Employee, EmployeeDetail, Event, Session, SessionDetail, State, TokenCounts, Tokens, ToolStep,
} from "../shared/types.js";
import { summarize } from "./summary.js";
import { shipKind } from "./ship.js";
import { mainRepo } from "./worktree.js";

const MAX = 4096;
const STEPS = 100;
const CHAT = 40, CHAT_TEXT = 600;
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

interface Extra { steps: ToolStep[]; report?: string; models: string[] } // oldest first
interface Pending { sessionId: string; type: string; description: string; prompt: string }

export class Store {
  private sessions = new Map<string, Session>();
  private employees = new Map<string, Employee>();
  private lastEvent = new Map<string, number>(); // sessionId -> now() ms
  private agentLast = new Map<string, number>(); // agentId -> time of its last event, ms
  private endedAt = new Map<string, number>(); // agentId -> now() ms
  private pending = new Map<string, Pending>(); // toolUseId -> spawn info
  private seen = new Map<string, Set<string>>(); // sessionId -> counted messageIds
  private mayorSteps = new Map<string, ToolStep[]>(); // sessionId -> steps, oldest first
  private skills = new Map<string, Set<string>>(); // sessionId -> Skill tool names used
  private lastPrompt = new Map<string, string>();
  private chat = new Map<string, ChatLine[]>(); // sessionId -> prompts and replies, oldest first
  private extra = new Map<string, Extra>(); // agentId -> detail-only data
  private dirtyS = new Set<string>();
  private dirtyE = new Set<string>();
  private removed: string[] = [];

  private repos = new Map<string, string | null>(); // cwd -> main repo when it is a worktree

  constructor(private now: () => number = Date.now, private repoOf: (cwd: string) => string | null = mainRepo) {}

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
    if ("agentId" in e && e.agentId) this.agentLast.set(e.agentId, Math.max(this.agentLast.get(e.agentId) ?? 0, this.ms(e.at)));
    if (e.kind === "meta") {
      let changed = false;
      const set = <K extends "title" | "branch" | "cwd">(k: K, v: string | undefined) => {
        if (v === undefined) return;
        const c = cut(v);
        if (s[k] !== c) { s[k] = c; changed = true; }
      };
      set("title", e.title); set("branch", e.branch); set("cwd", e.cwd);
      let root = this.repos.get(s.cwd);
      if (root === undefined && s.cwd) this.repos.set(s.cwd, (root = this.repoOf(s.cwd)));
      const last = (path: string) => path.split(/[/\\]/).filter(Boolean).pop();
      const p = (root ? last(root) : last(s.cwd)) ?? s.id.slice(0, 8);
      if (s.project !== p) { s.project = p; changed = true; }
      const repo = root ?? undefined, wt = root ? last(s.cwd) : undefined;
      if (s.repo !== repo || s.worktree !== wt) {
        if (repo) { s.repo = repo; s.worktree = wt; } else { delete s.repo; delete s.worktree; }
        changed = true;
      }
      if (changed) this.dirtyS.add(s.id);
      return;
    }
    this.activity(s, e.at);
    switch (e.kind) {
      case "prompt":
        if (e.text) {
          this.lastPrompt.set(s.id, cut(e.text));
          this.say(s.id, { at: e.at, role: "user", text: e.text });
        }
        s.status = "working"; s.district = "townhall";
        break;
      case "reply":
        this.say(s.id, { at: e.at, role: "claude", text: e.text });
        break;
      case "tool": {
        const sk = e.name === "Skill" ? (e.input as { skill?: unknown } | null)?.skill : undefined;
        if (typeof sk === "string" && sk) {
          const set = this.skills.get(s.id) ?? new Set<string>();
          this.skills.set(s.id, set.add(sk));
        }
        const step: ToolStep = { at: e.at, name: e.name, summary: summarize(e.name, e.input), district: e.district };
        let steps: ToolStep[];
        if (e.agentId) {
          const emp = this.employee(e.sessionId, e.agentId, e.at);
          if (e.district) emp.district = e.district;
          steps = this.extraOf(e.agentId).steps;
        } else {
          steps = this.mayorSteps.get(s.id) ?? [];
          this.mayorSteps.set(s.id, steps);
          s.status = "working";
          if (e.district) s.district = e.district;
        }
        const ship = e.agentId ? null : shipKind(e.name, e.input);
        if (ship) { const n = (s.ships ??= { push: 0, pr: 0 }); n[ship]++; }
        steps.push(step);
        if (steps.length > STEPS) steps.shift();
        break;
      }
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
        if (emp) {
          this.extraOf(emp.id).report = cut(e.text);
          this.finish(emp, e.at);
        }
        break;
      }
      case "turnEnd":
        if (e.agentId) this.finish(this.employee(e.sessionId, e.agentId, e.at), e.at);
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
        if (e.agentId) {
          addUsage(this.employee(e.sessionId, e.agentId, "").tokens, e.model, e.usage);
          const m = this.extraOf(e.agentId).models;
          if (!m.includes(e.model)) m.push(e.model);
        }
        else s.model = cut(e.model);
        break;
      }
    }
  }

  private say(id: string, l: ChatLine) {
    const c = this.chat.get(id) ?? [];
    this.chat.set(id, c);
    c.push({ ...l, text: l.text.length > CHAT_TEXT ? l.text.slice(0, CHAT_TEXT) + "…" : l.text });
    if (c.length > CHAT) c.shift();
  }

  private extraOf(agentId: string): Extra {
    let x = this.extra.get(agentId);
    if (!x) this.extra.set(agentId, (x = { steps: [], models: [] }));
    return x;
  }

  private finish(emp: Employee, at: string) {
    if (emp.status === "done") return;
    emp.status = "done"; emp.endedAt = at;
    this.endedAt.set(emp.id, this.now());
    this.dirtyE.add(emp.id);
  }

  tick(): void {
    const now = this.now();
    for (const [id, s] of [...this.sessions]) {
      const age = now - (this.lastEvent.get(id) ?? now);
      if (age >= HIDE_MS) {
        for (const a of s.employees) this.dropEmployee(a, false);
        this.sessions.delete(id); this.lastEvent.delete(id); this.dirtyS.delete(id);
        this.seen.delete(id); this.mayorSteps.delete(id); this.lastPrompt.delete(id); this.chat.delete(id);
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
    // a background agent whose end notification fell outside the tailed window: quiet as long as an idle session → done
    for (const [id, emp] of this.employees) {
      const last = this.agentLast.get(id) ?? this.ms(emp.startedAt);
      if (emp.status === "working" && now - last >= IDLE_MS) this.finish(emp, new Date(last).toISOString());
    }
    for (const [a, at] of [...this.endedAt]) if (now - at >= DONE_MS) this.dropEmployee(a, true);
  }

  private dropEmployee(id: string, detach: boolean) {
    const e = this.employees.get(id);
    if (!e) return;
    this.employees.delete(id); this.extra.delete(id); this.endedAt.delete(id); this.dirtyE.delete(id); this.agentLast.delete(id);
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

  skillsUsed(sessionId: string): string[] {
    return [...(this.skills.get(sessionId) ?? [])];
  }

  detailSession(id: string): SessionDetail | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    const staff = s.employees.map((a) => this.employees.get(a)).filter((e): e is Employee => !!e);
    const d: SessionDetail = { ...s, steps: [...(this.mayorSteps.get(id) ?? [])].reverse(), staff, chat: [...(this.chat.get(id) ?? [])].reverse() };
    const p = this.lastPrompt.get(id);
    if (p !== undefined) d.lastPrompt = p;
    return structuredClone(d);
  }

  detailEmployee(id: string): EmployeeDetail | undefined {
    const e = this.employees.get(id);
    if (!e) return undefined;
    const x = this.extra.get(id);
    const d: EmployeeDetail = { ...e, models: [...(x?.models ?? [])], steps: [...(x?.steps ?? [])].reverse() };
    if (x?.report !== undefined) d.report = x.report;
    return structuredClone(d);
  }

  drainDelta(): Delta | null {
    if (!this.dirtyS.size && !this.dirtyE.size && !this.removed.length) return null;
    const d: Delta = {
      sessions: structuredClone([...this.dirtyS].map((i) => this.sessions.get(i)!).filter(Boolean)),
      employees: structuredClone([...this.dirtyE].map((i) => this.employees.get(i)!).filter(Boolean)),
      removed: this.removed.filter((i) => !this.sessions.has(i) && !this.employees.has(i)),
    };
    this.dirtyS.clear(); this.dirtyE.clear(); this.removed = [];
    return d;
  }
}
