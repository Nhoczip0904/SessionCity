import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export const MARKER = "<!-- managed-by: BackendCity -->";
export class UserOwnedError extends Error {}

const CONTENT = `---
name: Explore
description: "Fast read-only agent for exploring codebases: finding files, searching code and answering questions about the code. Use for read-only investigation."
tools: Read, Grep, Glob
model: haiku
---

${MARKER}

You are a read-only codebase exploration agent. Search broadly first: use Glob for file names and Grep for symbols, strings and naming variants across several locations. Read the files that look relevant before drawing conclusions. Report the exact file paths and the findings that answer the question, and say clearly when something could not be found. Never create, modify or delete files, and never run commands that change anything.
`;

export function exploreState(dir: string): "off" | "on" | "user" {
  const file = join(dir, "Explore.md");
  if (!existsSync(file)) return "off";
  return readFileSync(file, "utf8").includes(MARKER) ? "on" : "user";
}

export function setExplore(dir: string, enabled: boolean): "off" | "on" {
  if (exploreState(dir) === "user") throw new UserOwnedError("Explore.md do người dùng tự viết");
  const file = join(dir, "Explore.md");
  if (!enabled) {
    if (existsSync(file)) unlinkSync(file);
    return "off";
  }
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `Explore.md.tmp-${randomBytes(4).toString("hex")}`);
  try {
    writeFileSync(tmp, CONTENT, { flag: "wx" });
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* temp may not exist */ }
    throw e;
  }
  return "on";
}
