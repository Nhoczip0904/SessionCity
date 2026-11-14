export type District =
  | "townhall" | "library" | "design" | "site" | "database" | "lab"
  | "review" | "factory" | "airport" | "watchtower" | "home";

export interface TokenCounts { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Tokens extends TokenCounts { byModel: Record<string, TokenCounts> }

export interface Session {
  id: string;
  project: string;
  cwd: string;
  branch?: string;
  title?: string;
  model?: string;
  /** main repo folder when this session works in a git worktree of it; `project` is then the repo's name */
  repo?: string;
  /** the worktree folder's own name */
  worktree?: string;
  /** `git push` / `gh pr create` commands the session has run */
  ships?: { push: number; pr: number };
  lastActivity: string;
  status: "working" | "waiting" | "idle";
  district: District;
  tokens: Tokens;
  employees: string[];
}

export interface Employee {
  id: string; // agentId
  sessionId: string;
  type: string;
  description: string;
  prompt: string;
  toolUseId: string;
  status: "working" | "done";
  district: District;
  startedAt: string;
  endedAt?: string;
  tokens: Tokens;
}

export interface ToolStep { at: string; name: string; summary: string; district: District | null }
export interface ChatLine { at: string; role: "user" | "claude"; text: string }
export interface SessionDetail extends Session { lastPrompt?: string; steps: ToolStep[]; staff: Employee[]; /** newest first */ chat: ChatLine[] }
export interface EmployeeDetail extends Employee { report?: string; models: string[]; steps: ToolStep[] }

export type Event =
  | { kind: "prompt"; sessionId: string; at: string; text: string }
  | { kind: "reply"; sessionId: string; at: string; text: string }
  | { kind: "tool"; sessionId: string; agentId?: string; at: string; name: string; input: unknown; district: District | null }
  | { kind: "spawn"; sessionId: string; at: string; toolUseId: string; type: string; description: string; prompt: string }
  | { kind: "report"; sessionId: string; at: string; toolUseId: string; text: string }
  | { kind: "turnEnd"; sessionId: string; agentId?: string; at: string }
  | { kind: "usage"; sessionId: string; at: string; agentId?: string; messageId: string; model: string; usage: TokenCounts }
  | { kind: "meta"; sessionId: string; at: string; title?: string; branch?: string; cwd?: string }
  | { kind: "agentMeta"; sessionId: string; agentId: string; toolUseId: string; type: string; description: string; at: string };

export interface State { sessions: Session[]; employees: Employee[] }
/** Changed items only; `removed` = ids of hidden sessions/employees. */
export interface Delta { sessions: Session[]; employees: Employee[]; removed: string[] }

export interface ShelfFile { id: string; scope: "user" | "project" | "local"; path: string; size: number }
export interface ShelfSkill { id: string; scope: "user" | "project" | "plugin"; plugin?: string; name: string; description: string; used: boolean }
export interface Shelf { files: ShelfFile[]; skills: ShelfSkill[] }

/** One open pull request on the review building's board. */
export interface PrRow { number: number; title: string; url: string | null; /** GitHub login of who opened it */ author: string | null; draft: boolean; review: "approved" | "changes" | "pending" | null; ci: "pass" | "fail" | "pending" | null }
/** The open PRs of one repo the sessions work in; `error` when gh could not list them. */
export interface RepoPrs { repo: string; prs: PrRow[]; error?: string }

// ---- the departments' boards (/api/building/:id) ----
/** A command a session ran (test, build, deploy...), as the transcript shows how it ended. */
export interface CmdRun { at: string; project: string; command: string; ok: boolean | null; /** how long it ran */ ms: number | null; /** a short result line, "" when none */ note: string }
export interface ChangedFile { path: string; status: "M" | "A" | "D" | "?"; add: number; del: number }
export interface RepoChanges { repo: string; files: ChangedFile[]; error?: string }
/** The footer of a chat: which model it last ran on, how full its context is, what it wrote and what is uncommitted in its repo. */
export interface SessionMeta { model: string | null; /** tokens in context after the last reply */ used: number; outputs: string[]; changes: RepoChanges[] }
/** A permission question a chat process of the city is waiting on; `summary` is the command or file in one line. */
export interface AskRow { session: string; id: string; tool: string; summary: string }
export interface CiRun { name: string; branch: string; at: string; state: "pass" | "fail" | "pending"; url: string | null }
export interface RepoCi { repo: string; runs: CiRun[]; error?: string }
export interface Alert { at: string; project: string; tool: string; text: string }
export interface Book { path: string; reads: number; project: string }
export interface Doc { repo: string; path: string; title: string; done: number; total: number; at: string }
export interface RepoMigrations { repo: string; items: { name: string; at: string }[] }
export interface InboxItem { id: string; project: string; title?: string; said: string; at: string }
export interface RestItem { id: string; project: string; title?: string; since: string }
export type BuildingId = "townhall" | "home" | "site" | "lab" | "factory" | "airport" | "watchtower" | "library" | "design" | "database";
export type BuildingData =
  | { id: "townhall"; items: InboxItem[] }
  | { id: "home"; items: RestItem[] }
  | { id: "site"; repos: RepoChanges[] }
  | { id: "lab" | "factory"; runs: CmdRun[] }
  | { id: "airport"; flights: CmdRun[]; ci: RepoCi[] }
  | { id: "watchtower"; alerts: Alert[] }
  | { id: "library"; books: Book[] }
  | { id: "design"; docs: Doc[] }
  | { id: "database"; repos: RepoMigrations[] };
