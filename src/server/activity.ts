import type { Alert, Book, CmdRun } from "../shared/types.js";
import { tail } from "./history.js";

/** One tool call of a session with how it ended. */
export interface Op { at: string; name: string; input: unknown; text: string; isError: boolean; /** call to result, null while there is no result */ ms: number | null }
/** A session's calls, with the project they belong to. */
export interface Ops { project: string; ops: Op[] }

const MAX_TEXT = 4000;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.filter(isObj).map((b) => (typeof b.text === "string" ? b.text : "")).join("\n") : "";

/** The tool calls in the tail of a transcript, oldest first, each paired with its result. */
export async function readOps(file: string): Promise<Op[]> {
  let raw: string;
  try {
    raw = await tail(file);
  } catch {
    return [];
  }
  const ops: Op[] = [];
  const open = new Map<string, Op>();
  for (const l of raw.split("\n")) {
    let rec: unknown;
    try {
      rec = JSON.parse(l);
    } catch {
      continue;
    }
    if (!isObj(rec) || !isObj(rec.message) || !Array.isArray(rec.message.content)) continue;
    const at = typeof rec.timestamp === "string" ? rec.timestamp : "";
    for (const b of rec.message.content.filter(isObj)) {
      if (rec.type === "assistant" && b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        const op: Op = { at, name: b.name, input: b.input, text: "", isError: false, ms: null };
        ops.push(op);
        open.set(b.id, op);
      } else if (rec.type === "user" && b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const op = open.get(b.tool_use_id);
        if (!op) continue;
        op.text = textOf(b.content).slice(0, MAX_TEXT);
        op.isError = b.is_error === true;
        const ms = Date.parse(at) - Date.parse(op.at);
        op.ms = Number.isFinite(ms) && ms >= 0 ? ms : null;
        open.delete(b.tool_use_id);
      }
    }
  }
  return ops;
}

const TEST = /\b(vitest|jest|pytest|mocha|phpunit|dotnet\s+test|go\s+test|cargo\s+test|(npm|pnpm|yarn)\s+(run\s+)?test)\b/;
const BUILD = /\b((npm|pnpm|yarn)\s+(run\s+)?build|dotnet\s+(build|publish)|tsc|vite\s+build|cargo\s+build|go\s+build|gradle|mvn|msbuild|make|docker\s+build)\b/;
const DEPLOY = /(\bgit\s+push\b|\bdeploy\b|\bpublish\b|\bdocker\s+push\b|\bkubectl\s+(apply|rollout)\b|\bgh\s+(release|pr\s+(merge|create))\b)/;
const FAILED = /\b[1-9]\d*\s+(failed|failing)\b|\bFailed:\s+[1-9]\d*|\bFAIL(ED)?\b/;

const firstLine = (s: string) => s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const commandOf = (o: Op): string | null => (o.name === "Bash" && isObj(o.input) && typeof o.input.command === "string" ? o.input.command : null);
const newestFirst = <T extends { at: string }>(a: T[]) => a.sort((x, y) => y.at.localeCompare(x.at));
const finished = (o: Op) => !(o.ms === null && o.text === "" && !o.isError);

/** The result line of a test run: the framework's own summary when it has one. */
function testNote(text: string): string {
  const m = /^\s*Tests:?\s+(\S.*)$/m.exec(text) ?? /^((?:Passed|Failed)!.*)$/m.exec(text);
  if (m) return cut(m[1].trim(), 80);
  const eq = [...text.matchAll(/^=+\s*(.+?)\s*=+$/gm)].at(-1);
  if (eq) return cut(eq[1], 80);
  return cut(text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "", 80);
}

function runs(all: Ops[], want: (cmd: string) => boolean, verdict: (o: Op) => boolean | null, note: (o: Op, ok: boolean | null) => string, max = 30): CmdRun[] {
  const out: CmdRun[] = [];
  for (const { project, ops } of all)
    for (const o of ops) {
      const c = commandOf(o);
      if (c === null || !want(c)) continue;
      const ok = verdict(o);
      out.push({ at: o.at, project, command: cut(firstLine(c), 90), ok, ms: o.ms, note: note(o, ok) });
    }
  return newestFirst(out).slice(0, max);
}

export const tests = (all: Ops[]) =>
  runs(all, (c) => TEST.test(c), (o) => (finished(o) ? !o.isError && !FAILED.test(o.text) : null), (o) => testNote(o.text));
export const builds = (all: Ops[]) =>
  runs(all, (c) => BUILD.test(c) && !TEST.test(c), (o) => (finished(o) ? !o.isError : null), (o, ok) => (ok === false ? cut(firstLine(o.text), 80) : ""));
export const flights = (all: Ops[]) =>
  runs(all, (c) => DEPLOY.test(c), (o) => (finished(o) ? !o.isError : null), () => "");

const REFUSED = /^(The user doesn't want|\[Request interrupted|User rejected)/;

/** Tool calls that failed, newest first; a refusal by the user is no alert. */
export function alerts(all: Ops[]): Alert[] {
  const out: Alert[] = [];
  for (const { project, ops } of all)
    for (const o of ops) if (o.isError && !REFUSED.test(o.text.trim())) out.push({ at: o.at, project, tool: o.name, text: cut(firstLine(o.text), 140) });
  return newestFirst(out).slice(0, 40);
}

/** The files read most, across sessions. */
export function books(all: Ops[]): Book[] {
  const seen = new Map<string, Book>();
  for (const { project, ops } of all)
    for (const o of ops) {
      if (o.name !== "Read" || !isObj(o.input) || typeof o.input.file_path !== "string") continue;
      const b = seen.get(o.input.file_path);
      if (b) b.reads++;
      else seen.set(o.input.file_path, { path: o.input.file_path, reads: 1, project });
    }
  return [...seen.values()].sort((a, b) => b.reads - a.reads || a.path.localeCompare(b.path)).slice(0, 14);
}
