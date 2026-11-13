export interface PtyProc {
  onData(cb: (d: string) => void): unknown;
  onExit(cb: (e: { exitCode: number }) => void): unknown;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export type PtySpawn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
) => PtyProc;
export interface Term {
  onData(cb: (d: string) => void): void;
  onExit(cb: (code: number) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  /** Ends the process. */
  kill(): void;
  /** Lets go of the terminal but keeps the process, so the next open of the session picks it up again. */
  release(): void;
}

const PARK_MS = 10 * 60_000; // a released process is kept this long

interface Entry {
  sid: string;
  proc: PtyProc;
  exited: boolean;
  attached: boolean;
  data: ((d: string) => void) | null;
  exit: ((code: number) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  order: number; // when it was last released; the lowest is evicted first
}

export class PtyHub {
  private live = new Set<Entry>();
  private clock = 0;
  constructor(
    private spawn: PtySpawn,
    private claude: string | null,
    private max = 3,
    private parkMs = PARK_MS,
  ) {}

  /** Processes alive, parked ones included. */
  get size(): number {
    return this.live.size;
  }

  /** True while a terminal is attached to the session's process. */
  isOpen(sessionId: string): boolean {
    for (const e of this.live) if (e.sid === sessionId && e.attached) return true;
    return false;
  }

  open(sessionId: string, cwd: string, cols: number, rows: number): Term | null {
    if (!this.claude) return null;
    let entry = [...this.live].find((e) => e.sid === sessionId && !e.attached);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.attached = true;
      try {
        // the new screen is empty: a size change makes the TUI repaint it
        entry.proc.resize(cols + 1, rows);
        entry.proc.resize(cols, rows);
      } catch {
        // exited meanwhile; its exit event follows
      }
    } else {
      if (this.live.size >= this.max && !this.evict()) return null;
      const proc = this.spawn(this.claude, ["--resume", sessionId], { name: "xterm-256color", cols, rows, cwd, env: process.env });
      const e: Entry = { sid: sessionId, proc, exited: false, attached: true, data: null, exit: null, timer: null, order: 0 };
      entry = e;
      this.live.add(e);
      proc.onData((d) => e.data?.(d));
      proc.onExit((x) => {
        e.exited = true;
        this.live.delete(e);
        if (e.timer) clearTimeout(e.timer);
        e.exit?.(x.exitCode);
      });
    }
    return this.handle(entry);
  }

  private handle(entry: Entry): Term {
    let mine = true; // false once this handle is released or killed
    const ok = () => mine && !entry.exited;
    return {
      onData: (cb) => void (entry.data = cb),
      onExit: (cb) => void (entry.exit = cb),
      write: (d) => void (ok() && entry.proc.write(d)),
      resize: (c, r) => void (ok() && entry.proc.resize(c, r)),
      kill: () => {
        mine = false;
        this.kill(entry);
      },
      release: () => {
        if (!ok()) return;
        mine = false;
        entry.attached = false;
        entry.data = entry.exit = null;
        entry.order = ++this.clock;
        entry.timer = setTimeout(() => this.kill(entry), this.parkMs);
        entry.timer.unref?.();
      },
    };
  }

  private kill(entry: Entry): void {
    if (entry.exited) return;
    entry.exited = true; // node-pty throws on a second kill
    this.live.delete(entry); // free the slot now; conpty's exit event can lag or never come
    if (entry.timer) clearTimeout(entry.timer);
    entry.proc.kill();
  }

  private evict(): boolean {
    let oldest: Entry | null = null;
    for (const e of this.live) if (!e.attached && (!oldest || e.order < oldest.order)) oldest = e;
    if (oldest) this.kill(oldest);
    return !!oldest;
  }

  /** Ends the session's parked process, if any: another kind of client is about to resume the same session. */
  drop(sessionId: string): void {
    for (const e of [...this.live]) if (e.sid === sessionId && !e.attached) this.kill(e);
  }

  killAll(): void {
    for (const e of [...this.live]) this.kill(e);
  }
}
