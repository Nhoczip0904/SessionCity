import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** The main repo a git worktree folder belongs to; null for an ordinary folder (or anything unreadable). */
export function mainRepo(cwd: string): string | null {
  try {
    const dotGit = join(cwd, ".git");
    if (!statSync(dotGit).isFile()) return null; // a worktree's .git is a file that points at the main repo's .git/worktrees/<name>
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    if (!m) return null;
    const dir = resolve(cwd, m[1]!.trim());
    const worktrees = dirname(dir), gitDir = dirname(worktrees);
    if (basename(worktrees) !== "worktrees" || basename(gitDir) !== ".git") return null; // a submodule points into .git/modules
    return dirname(gitDir);
  } catch {
    return null;
  }
}
