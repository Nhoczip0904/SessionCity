import { open } from "node:fs/promises";
import type { BgJob } from "../shared/types.js";
import { summarize } from "./summary.js";

export type HistoryItem = { role: "user" | "claude"; text: string } | { role: "tool"; name: string; summary: string; input?: Record<string, unknown> };

const TAIL = 4 * 1024 * 1024;
const MAX_TEXT = 20000;
const MAX_INPUT = 20000; // chars of JSON; a bigger tool input is left out, the row shows its summary
const NOT_TYPED = /<(command-name|local-command-|system-reminder|task-notification)/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const cut = (s: string) => s.slice(0, MAX_TEXT);

export async function tail(file: string): Promise<string> {
  const fh = await open(file, "r");
  try {
    const size = (await fh.stat()).size;
    const offset = Math.max(0, size - TAIL);
    const buf = Buffer.alloc(size - offset);
    await fh.read(buf, 0, buf.length, offset);
    const s = buf.toString("utf8");
    if (offset === 0) return s;
    const nl = s.indexOf("\n");
    return nl < 0 ? "" : s.slice(nl + 1); // first line is partial
  } finally {
    await fh.close();
  }
}

const DONE_KEEP = 10 * 60_000; // a finished job stays listed this long
const LOST_AFTER = 30 * 60_000; // a running job with no notice this long is taken as lost
const TASK_ID = /<task-id>([^<]+)<\/task-id>/;
const TASK_STATUS = /<status>([^<]+)<\/status>/;
const LAUNCHED = /running in background with ID: (\S+?)\.?(?:\s|$)/;

/** Background Bash jobs of a session: started by a run_in_background tool_use, ended by a task-notification. */
export async function bgJobs(file: string, now = Date.now()): Promise<BgJob[]> {
  let raw: string;
  try {
    raw = await tail(file);
  } catch {
    return [];
  }
  const jobs = new Map<string, BgJob>(); // by task id once known, else by tool_use id
  const byUse = new Map<string, string>(); // tool_use id -> key in jobs
  for (const l of raw.split("\n")) {
    let rec: unknown;
    try {
      rec = JSON.parse(l);
    } catch {
      continue;
    }
    if (!isObj(rec) || !isObj(rec.message)) continue;
    const ts = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const c = rec.message.content;
    const parts = Array.isArray(c) ? c.filter(isObj) : [];
    if (rec.type === "assistant") {
      for (const b of parts) {
        if (b.type !== "tool_use" || b.name !== "Bash" || typeof b.id !== "string" || !isObj(b.input) || b.input.run_in_background !== true) continue;
        jobs.set(b.id, { id: b.id, cmd: summarize("Bash", b.input), start: ts });
        byUse.set(b.id, b.id);
      }
    } else if (rec.type === "user") {
      for (const b of parts) {
        if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
        const key = byUse.get(b.tool_use_id);
        const m = key && LAUNCHED.exec(typeof b.content === "string" ? b.content : JSON.stringify(b.content));
        if (!key || !m) continue;
        const job = jobs.get(key)!;
        jobs.delete(key);
        job.id = m[1]!;
        jobs.set(job.id, job);
      }
      const t = typeof c === "string" ? c : parts.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
      const id = TASK_ID.exec(t)?.[1];
      const status = TASK_STATUS.exec(t)?.[1];
      const job = id ? jobs.get(id) : undefined;
      if (job && status && status !== "running") {
        job.end = ts;
        job.ok = status === "completed";
      }
    }
  }
  return [...jobs.values()].filter((j) => (j.end === undefined ? now - j.start < LOST_AFTER : now - j.end < DONE_KEEP));
}

/** Last n chat items of a session transcript, oldest first. */
export async function history(file: string, n = 50): Promise<HistoryItem[]> {
  let raw: string;
  try {
    raw = await tail(file);
  } catch {
    return [];
  }
  const out: HistoryItem[] = [];
  for (const l of raw.split("\n")) {
    let rec: unknown;
    try {
      rec = JSON.parse(l);
    } catch {
      continue;
    }
    if (!isObj(rec) || !isObj(rec.message)) continue;
    const c = rec.message.content;
    const parts = Array.isArray(c) ? c.filter(isObj) : [];
    if (rec.type === "user" && rec.isMeta !== true && rec.isCompactSummary !== true) {
      const t = typeof c === "string" ? c : parts.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
      if (t.trim() && !NOT_TYPED.test(t)) out.push({ role: "user", text: cut(t) });
    } else if (rec.type === "assistant") {
      for (const b of parts) {
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) out.push({ role: "claude", text: cut(b.text) });
        else if (b.type === "tool_use" && typeof b.name === "string") {
          const item: HistoryItem = { role: "tool", name: b.name, summary: summarize(b.name, b.input) };
          if (isObj(b.input) && JSON.stringify(b.input).length <= MAX_INPUT) item.input = b.input;
          out.push(item);
        }
      }
    }
  }
  return out.slice(-n);
}
