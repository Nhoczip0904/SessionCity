/** "push" for a `git push`, "pr" for a `gh pr create` run through Bash; null for anything else. */
export function shipKind(name: string, input: unknown): "push" | "pr" | null {
  const cmd = name === "Bash" && input && typeof input === "object" ? (input as { command?: unknown }).command : undefined;
  if (typeof cmd !== "string") return null;
  // shortcut: matches the words anywhere in the command line (even in a quoted string), upgrade if false alarms show up
  if (/(^|[;&|(]\s*)gh\s+pr\s+create\b/.test(cmd)) return "pr";
  if (/(^|[;&|(]\s*)git\b[^;&|]*?\bpush\b/.test(cmd)) return "push";
  return null;
}
