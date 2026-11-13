import { el } from "./launcher.js";

const MAX_LINES = 200;
type Input = Record<string, unknown>;
const str = (v: unknown): v is string => typeof v === "string";

/** `-`/`+` lines of a change; no line matching, so an edit shows its old text whole, then its new text. */
function lines(cls: "add" | "del", text: string, out: HTMLElement) {
  const all = text.split("\n");
  for (const l of all.slice(0, MAX_LINES)) out.append(el("div", `${cls === "add" ? "+" : "-"} ${l}`, cls));
  if (all.length > MAX_LINES) out.append(el("div", `… ${all.length - MAX_LINES} dòng nữa`, "more"));
}

/** What a tool call shows instead of its raw input, or null when the input is shown as plain JSON. */
export function toolBody(name: string, input: Input): HTMLElement | null {
  if (name === "Bash" && str(input.command)) return el("pre", `$ ${input.command}`, "term");
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    const ul = el("ul", undefined, "todos");
    for (const t of input.todos as { content?: unknown; status?: unknown }[]) {
      const status = t.status === "completed" || t.status === "in_progress" ? t.status : "pending";
      ul.append(el("li", `${status === "completed" ? "☑" : status === "in_progress" ? "◐" : "☐"} ${String(t.content ?? "")}`, status));
    }
    return ul;
  }
  if (!str(input.file_path)) return null;
  const box = el("div", undefined, "diff");
  box.append(el("div", input.file_path, "diff-file"));
  if (name === "Edit" && str(input.old_string) && str(input.new_string)) {
    lines("del", input.old_string, box);
    lines("add", input.new_string, box);
  } else if (name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const e of input.edits as { old_string?: unknown; new_string?: unknown }[]) {
      if (str(e.old_string)) lines("del", e.old_string, box);
      if (str(e.new_string)) lines("add", e.new_string, box);
    }
  } else if (name === "Write" && str(input.content)) lines("add", input.content, box);
  else return null;
  return box;
}
