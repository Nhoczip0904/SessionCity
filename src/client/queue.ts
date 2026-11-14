import type { Session } from "../shared/types.js";
import type { LaunchOpts } from "./launcher.js";

export const MAX_WORKING = 3;
/** After one job starts, wait this long before the next so the new session has time to show up as working. */
const GAP_MS = 20_000;
const MAX_JOBS = 50;

/** Jobs waiting for a free place: each starts when fewer than MAX_WORKING sessions are working. Kept in the browser, so jobs start only while the city page is open. */
export class JobQueue {
  private jobs: LaunchOpts[] = [];
  private last = -Infinity;

  constructor(
    private disk: { get(): string | null; set(v: string): void },
    private now: () => number = Date.now,
  ) {
    try {
      const v = JSON.parse(disk.get() ?? "[]");
      if (Array.isArray(v)) this.jobs = v.filter((j) => j && typeof j.cwd === "string").slice(0, MAX_JOBS);
    } catch {
      /* a damaged list is an empty one */
    }
  }

  get size(): number {
    return this.jobs.length;
  }

  /** Adds a job; returns how many wait now. Over the limit the newest is refused and the count stays. */
  add(job: LaunchOpts): number {
    if (this.jobs.length < MAX_JOBS) this.jobs.push(job);
    this.disk.set(JSON.stringify(this.jobs));
    return this.jobs.length;
  }

  /** The job to start now, taken off the queue; undefined when it is empty, the sessions are busy, or one just started. */
  take(sessions: Session[]): LaunchOpts | undefined {
    if (!this.jobs.length || sessions.filter((s) => s.status === "working").length >= MAX_WORKING) return;
    const t = this.now();
    if (t - this.last < GAP_MS) return;
    this.last = t;
    const job = this.jobs.shift();
    this.disk.set(JSON.stringify(this.jobs));
    return job;
  }
}
