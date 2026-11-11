import type { Event, TokenCounts } from "../shared/types.js";
import { classify, type Rule } from "./classify.js";

export interface LineContext { sessionId: string; agentId?: string }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : 0);

function blocks(content: unknown): Obj[] {
  return Array.isArray(content) ? content.filter(isObj) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return blocks(content)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/** A background agent's end, announced by a <task-notification>, closes the Agent call it came from. */
function taskDone(raw: string, sessionId: string, at: string): Event | null {
  const m = /<task-notification>[\s\S]*?<tool-use-id>([^<]+)<\/tool-use-id>[\s\S]*?<status>(completed|failed|stopped|killed)<\/status>(?:[\s\S]*?<summary>([^<]*)<\/summary>)?/.exec(raw);
  return m ? { kind: "report", sessionId, at, toolUseId: m[1].trim(), text: (m[3] ?? "").trim() } : null;
}

export function parseLine(line: string, ctx: LineContext, rules: Rule[]): Event[] {
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(rec)) return [];
  const { sessionId, agentId } = ctx;
  const at = str(rec.timestamp) ?? "";
  const out: Event[] = [];
  const msg = isObj(rec.message) ? rec.message : {};

  const cwd = str(rec.cwd);
  const branch = str(rec.gitBranch);
  const title = rec.type === "custom-title" ? str(rec.customTitle) ?? str(rec.title) : undefined;
  if (!agentId && (cwd !== undefined || branch !== undefined || title !== undefined)) {
    const m: Event = { kind: "meta", sessionId, at };
    if (title !== undefined) m.title = title;
    if (branch !== undefined) m.branch = branch;
    if (cwd !== undefined) m.cwd = cwd;
    out.push(m);
  }

  if (rec.type === "user" && rec.isMeta !== true) {
    const parts = blocks(msg.content);
    const results = parts.filter((b) => b.type === "tool_result" && typeof b.tool_use_id === "string");
    for (const r of results) {
      const text = resultText(r.content);
      // a background Agent call returns at once; its real end arrives later as a <task-notification>
      if (!text.startsWith("Async agent launched")) out.push({ kind: "report", sessionId, at, toolUseId: r.tool_use_id as string, text });
    }
    const isText = typeof msg.content === "string" || parts.some((b) => b.type === "text");
    if (isText && results.length === 0 && !agentId) {
      const raw = typeof msg.content === "string" ? msg.content : resultText(parts);
      // not typed by the human: still a prompt event (status/townhall), but no text for lastPrompt
      const synthetic = rec.isCompactSummary === true || /^(<task-notification|<local-command-|<system-reminder|\[Request interrupted)/.test(raw.trimStart());
      out.push({ kind: "prompt", sessionId, at, text: synthetic ? "" : raw });
      const done = taskDone(raw, sessionId, at);
      if (done) out.push(done);
    }
  } else if (rec.type === "queue-operation" && rec.operation === "enqueue" && typeof rec.content === "string" && !agentId) {
    // the desktop app queues background-agent notifications here instead of as a user message
    const done = taskDone(rec.content, sessionId, at);
    if (done) out.push(done);
  } else if (rec.type === "assistant") {
    const uses = blocks(msg.content).filter((b) => b.type === "tool_use" && typeof b.name === "string");
    for (const u of uses) {
      const name = u.name as string;
      const input = u.input;
      const ev: Event = { kind: "tool", sessionId, at, name, input, district: classify(rules, name, input) };
      if (agentId) ev.agentId = agentId;
      out.push(ev);
      if ((name === "Agent" || name === "Task") && typeof u.id === "string") {
        const i = isObj(input) ? input : {};
        out.push({
          kind: "spawn", sessionId, at, toolUseId: u.id,
          type: str(i.subagent_type) ?? "general-purpose",
          description: str(i.description) ?? "",
          prompt: str(i.prompt) ?? "",
        });
      }
    }
    if (isObj(msg.usage)) {
      const u = msg.usage;
      const usage: TokenCounts = {
        input: num(u.input_tokens), output: num(u.output_tokens),
        cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens),
      };
      const ev: Event = {
        kind: "usage", sessionId, at, messageId: str(msg.id) ?? str(rec.uuid) ?? "",
        model: str(msg.model) ?? "unknown", usage,
      };
      if (agentId) ev.agentId = agentId;
      out.push(ev);
    }
    if (msg.stop_reason === "end_turn" && uses.length === 0) {
      const ev: Event = { kind: "turnEnd", sessionId, at };
      if (agentId) ev.agentId = agentId;
      out.push(ev);
    }
  }
  return out;
}

export function parseMeta(json: string, ctx: { sessionId: string; agentId: string; at: string }): Event | null {
  let m: unknown;
  try {
    m = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  const type = str(m.agentType);
  const toolUseId = str(m.toolUseId);
  if (type === undefined || toolUseId === undefined) return null;
  return {
    kind: "agentMeta", sessionId: ctx.sessionId, agentId: ctx.agentId, toolUseId,
    type, description: str(m.description) ?? "", at: ctx.at,
  };
}
