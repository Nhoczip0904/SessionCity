import { DISTRICTS } from "../shared/districts.js";
import type { District } from "../shared/types.js";

export interface Rule { district: District; tool?: string; command?: string; path?: string }
type Compiled = { district: District; tool?: RegExp; command?: RegExp; path?: RegExp };

const compiled = new WeakMap<Rule[], Compiled[]>();
const FIELDS = ["tool", "command", "path"] as const;

export function loadRules(json: unknown): Rule[] {
  if (!Array.isArray(json)) throw new Error("districts.json: expected an array");
  const out: Compiled[] = [];
  const rules = json.map((r, i): Rule => {
    const n = i + 1;
    if (!r || typeof r !== "object" || !DISTRICTS.some((d) => d.id === r.district))
      throw new Error(`districts.json: rule ${n} has unknown district`);
    const c: Compiled = { district: r.district };
    for (const f of FIELDS) {
      if (r[f] === undefined) continue;
      try {
        c[f] = new RegExp(r[f], "i");
      } catch {
        throw new Error(`districts.json: rule ${n} has invalid regex in "${f}"`);
      }
    }
    out.push(c);
    return r as Rule;
  });
  compiled.set(rules, out);
  return rules;
}

export function classify(rules: Rule[], tool: string, input: unknown): District | null {
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const command = str(inp.command);
  const path = str(inp.file_path ?? inp.notebook_path ?? inp.path);
  for (const r of compiled.get(rules) ?? []) {
    if (r.tool && !r.tool.test(tool)) continue;
    if (r.command && !r.command.test(command)) continue;
    if (r.path && !r.path.test(path)) continue;
    return r.district;
  }
  return null;
}
