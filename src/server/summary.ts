const MAX = 200;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function raw(name: string, input: unknown): string | undefined {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (name) {
    case "Bash":
      return str(i.command);
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
      return str(i.file_path);
    case "NotebookEdit":
      return str(i.notebook_path);
    case "Grep": {
      const p = str(i.pattern);
      const path = str(i.path);
      return p === undefined ? undefined : path ? `${p} in ${path}` : p;
    }
    case "Glob":
      return str(i.pattern);
    case "WebFetch":
      return str(i.url);
    case "WebSearch":
      return str(i.query);
    case "Agent":
    case "Task": {
      const type = str(i.subagent_type) ?? "general-purpose";
      const d = str(i.description);
      return d ? `${type}: ${d}` : type;
    }
  }
}

export function summarize(name: string, input: unknown): string {
  const s = raw(name, input) ?? name;
  return s.length > MAX ? s.slice(0, MAX - 1) + "…" : s;
}
