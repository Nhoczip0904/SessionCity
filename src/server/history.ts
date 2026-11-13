import { open } from "node:fs/promises";
import { summarize } from "./summary.js";

export type HistoryItem = { role: "user" | "claude"; text: string } | { role: "tool"; name: string; summary: string; input?: Record<string, unknown> };

const TAIL = 4 * 1024 * 1024;
const MAX_TEXT = 20000;
const MAX_INPUT = 20000; // chars of JSON; a bigger tool input is left out, the row shows its summary
const NOT_TYPED = /<(command-name|local-command-|system-reminder)/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const cut = (s: string) => s.slice(0, MAX_TEXT);

async function tail(file: string): Promise<string> {
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
