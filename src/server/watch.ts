import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Event } from "../shared/types.js";
import { loadRules, type Rule } from "./classify.js";
import { parseLine, parseMeta } from "./parse.js";
import { Tailer, tailStart } from "./tail.js";

/** Nearest ancestor of this file holding package.json (works from src/ and dist/). */
export function packageRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(d, "package.json"))) {
    const up = dirname(d);
    if (up === d) throw new Error("package.json not found");
    d = up;
  }
  return d;
}

export function loadConfigRules(): Rule[] {
  return loadRules(JSON.parse(readFileSync(join(packageRoot(), "config", "districts.json"), "utf8")));
}

interface Tracked {
  tailer: Tailer;
  sessionId: string;
  agentId?: string;
  metaPath?: string; // set until the meta file has been read
}

const entries = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);

export class Watcher {
  private tracked = new Map<string, Tracked>(); // one Tailer per path for the server's lifetime
  private rules: Rule[];
  private intervalMs: number;
  private maxAgeMs: number;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private root: string,
    private onEvents: (events: Event[]) => void,
    opts: { intervalMs?: number; maxAgeMs?: number; rules?: Rule[] } = {},
  ) {
    this.rules = opts.rules ?? loadConfigRules();
    this.intervalMs = opts.intervalMs ?? 2000;
    this.maxAgeMs = opts.maxAgeMs ?? 24 * 3600_000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.tick();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      await this.scan();
      const events = await this.readAll();
      if (events.length && !this.stopped) this.onEvents(events);
    } catch {
      // skip this tick
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.tick(), this.intervalMs);
      this.timer.unref();
    }
  }

  private async discover(path: string, t: Omit<Tracked, "tailer">): Promise<void> {
    if (this.tracked.has(path)) return;
    try {
      const st = await stat(path);
      if (Date.now() - st.mtimeMs > this.maxAgeMs) return;
      this.tracked.set(path, { ...t, tailer: new Tailer(path, tailStart(st.size)) });
    } catch {
      // vanished; retry next scan
    }
  }

  private async scan(): Promise<void> {
    for (const proj of await entries(this.root)) {
      if (!proj.isDirectory()) continue;
      const pdir = join(this.root, proj.name);
      for (const e of await entries(pdir)) {
        if (e.isFile() && e.name.endsWith(".jsonl")) {
          await this.discover(join(pdir, e.name), { sessionId: e.name.slice(0, -6) });
        } else if (e.isDirectory()) {
          const sdir = join(pdir, e.name, "subagents");
          for (const f of await entries(sdir)) {
            const m = /^agent-(.+)\.jsonl$/.exec(f.name);
            if (!f.isFile() || !m) continue;
            const path = join(sdir, f.name);
            await this.discover(path, {
              sessionId: e.name,
              agentId: m[1],
              metaPath: join(sdir, `agent-${m[1]}.meta.json`),
            });
          }
        }
      }
    }
  }

  private async readAll(): Promise<Event[]> {
    const out: Event[] = [];
    for (const t of this.tracked.values()) {
      if (t.metaPath) {
        try {
          const at = (await stat(t.metaPath)).mtime.toISOString();
          const ev = parseMeta(await readFile(t.metaPath, "utf8"), { sessionId: t.sessionId, agentId: t.agentId!, at });
          if (ev) {
            out.push(ev);
            t.metaPath = undefined; // invalid/partial meta is retried
          }
        } catch {
          // not there yet; retry on a later scan
        }
      }
      try {
        const ctx = { sessionId: t.sessionId, agentId: t.agentId };
        for (const line of await t.tailer.read()) out.push(...parseLine(line, ctx, this.rules));
      } catch {
        // skip this tick
      }
    }
    return out;
  }
}
