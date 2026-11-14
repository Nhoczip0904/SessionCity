import type { SessionMeta } from "../shared/types.js";
import { tail } from "./history.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const MAX_OUT = 12;

/** What the footer of a chat shows, read from the transcript's tail: model, tokens in context, files the session wrote. */
export async function readMeta(file: string): Promise<Pick<SessionMeta, "model" | "used" | "outputs">> {
  const out: string[] = [];
  let model: string | null = null, used = 0;
  let raw = "";
  try {
    raw = await tail(file);
  } catch {
    // no transcript yet: an empty footer
  }
  for (const l of raw.split("\n")) {
    let rec: unknown;
    try {
      rec = JSON.parse(l);
    } catch {
      continue;
    }
    if (!isObj(rec)) continue;
    if (rec.type !== "assistant" || !isObj(rec.message) || rec.isSidechain === true) continue;
    const m = rec.message, u = m.usage;
    if (typeof m.model === "string" && !m.model.startsWith("<")) model = m.model;
    if (isObj(u)) used = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].reduce((n, k) => n + (typeof u[k] === "number" ? (u[k] as number) : 0), 0);
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!isObj(b) || b.type !== "tool_use" || (b.name !== "Write" && b.name !== "NotebookEdit") || !isObj(b.input)) continue;
      const p = b.input.file_path ?? b.input.notebook_path;
      if (typeof p === "string") out.push(p);
    }
  }
  const outputs = [...new Set(out.reverse())].slice(0, MAX_OUT); // newest first, each once
  return { model, used, outputs };
}
