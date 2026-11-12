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
  kill(): void;
}

interface Entry {
  sid: string;
  proc: PtyProc;
  exited: boolean;
}

export class PtyHub {
  private live = new Set<Entry>();
  constructor(
    private spawn: PtySpawn,
    private claude: string | null,
    private max = 3,
  ) {}

  get size(): number {
    return this.live.size;
  }

  isOpen(sessionId: string): boolean {
    for (const e of this.live) if (e.sid === sessionId) return true;
    return false;
  }

  open(sessionId: string, cwd: string, cols: number, rows: number): Term | null {
    if (!this.claude || this.live.size >= this.max) return null;
    const proc = this.spawn(this.claude, ["--resume", sessionId], { name: "xterm-256color", cols, rows, cwd, env: process.env });
    const entry: Entry = { sid: sessionId, proc, exited: false };
    this.live.add(entry);
    proc.onExit(() => {
      entry.exited = true;
      this.live.delete(entry);
    });
    const kill = () => {
      if (entry.exited) return;
      entry.exited = true; // node-pty throws on a second kill
      this.live.delete(entry); // free the slot now; conpty's exit event can lag or never come
      proc.kill();
    };
    return {
      onData: (cb) => void proc.onData(cb),
      onExit: (cb) => void proc.onExit((e) => cb(e.exitCode)),
      write: (d) => void (!entry.exited && proc.write(d)),
      resize: (c, r) => void (!entry.exited && proc.resize(c, r)),
      kill,
    };
  }

  killAll(): void {
    for (const e of [...this.live]) {
      if (!e.exited) e.proc.kill();
      e.exited = true;
      this.live.delete(e);
    }
  }
}
