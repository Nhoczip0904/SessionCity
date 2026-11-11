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
