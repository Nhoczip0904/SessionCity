import { execFile } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface ChatProc {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  pid?: number;
  on(ev: "exit", cb: (code: number | null) => void): unknown;
  on(ev: "error", cb: (e: Error) => void): unknown;
  kill(): unknown;
}
export type ChatSpawn = (
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: "pipe"; windowsHide: true },
) => ChatProc;
export interface Chat {
  onEvent(cb: (e: Record<string, unknown>) => void): void;
  onExit(cb: (code: number, lastErr: string) => void): void;
  say(text: string): void;
  answer(requestId: string, allow: boolean): void;
  interrupt(): void;
  /** Ends the process. */
  kill(): void;
  /** Lets go of the chat but keeps the process, so the next open of the session picks it up again. */
  release(): void;
  pending(requestId: string): boolean;
}

type Ev = Record<string, unknown>;
interface Entry {
  sid: string;
  proc: ChatProc;
  exited: boolean; // slot freed
  gone: boolean; // process really ended
  attached: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  order: number; // when it was last released; the lowest is evicted first
  events: ((e: Ev) => void)[];
  exits: ((code: number, lastErr: string) => void)[];
  asks: Map<string, Ev>; // unanswered can_use_tool requests, by id
  errTail: string;
  n: number;
  ended: boolean;
}

const GRACE_MS = 2000;
const PARK_MS = 10 * 60_000; // a released process is kept this long
// claude.exe dies alone under ChildProcess.kill(); tool subprocesses it started would be orphaned
const taskkill = (pid: number) => void execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => {});

export class ChatHub {
  private live = new Set<Entry>();
  private clock = 0;
  constructor(
    private spawn: ChatSpawn,
    private claude: string | null,
    private max = 3,
    private treeKill: (pid: number) => void = taskkill,
    private parkMs = PARK_MS,
  ) {}

  /** Processes alive, parked ones included. */
  get size(): number {
    return this.live.size;
  }

  /** True while a chat is attached to the session's process. */
  isOpen(sessionId: string): boolean {
    for (const e of this.live) if (e.sid === sessionId && e.attached) return true;
    return false;
  }

  private force(proc: ChatProc): void {
    if (process.platform === "win32" && proc.pid) this.treeKill(proc.pid);
    else proc.kill();
  }

  open(sessionId: string, cwd: string): Chat | null {
    if (!this.claude) return null;
    const parked = [...this.live].find((e) => e.sid === sessionId && !e.attached);
    if (parked) {
      if (parked.timer) clearTimeout(parked.timer);
      parked.timer = null;
      parked.attached = true;
      return this.handle(parked, true);
    }
    if (this.live.size >= this.max && !this.evict()) return null;
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--resume", sessionId, "--permission-prompts", "host", "--permission-prompt-tool", "stdio"];
    const proc = this.spawn(this.claude, args, { cwd, env: process.env, stdio: "pipe", windowsHide: true });
    const entry: Entry = { sid: sessionId, proc, exited: false, gone: false, attached: true, timer: null, order: 0, events: [], exits: [], asks: new Map(), errTail: "", n: 0, ended: false };
    this.live.add(entry);
    proc.on("error", () => {
      entry.gone = true;
      this.end(entry, 1);
    }); // a failed spawn may never emit exit; must not crash or leak the slot
    proc.stdin.on("error", () => {}); // EPIPE after exit
    proc.on("exit", (code) => {
      entry.gone = true;
      this.end(entry, code ?? 1);
    });
    const edec = new StringDecoder("utf8");
    proc.stderr.on("data", (d: Buffer | string) => {
      entry.errTail = (entry.errTail + (typeof d === "string" ? d : edec.write(d))).slice(-2000); // drain: a full pipe would hang claude
    });
    proc.stderr.on("error", () => {});
    const dec = new StringDecoder("utf8");
    let buf = "";
    proc.stdout.on("data", (d: Buffer | string) => {
      buf += typeof d === "string" ? d : dec.write(d);
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let e: Ev;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        const r = e.request as { subtype?: string } | undefined;
        if (e.type === "control_request" && r?.subtype === "can_use_tool" && typeof e.request_id === "string") entry.asks.set(e.request_id, e);
        for (const f of entry.events) f(e);
      }
    });
    proc.stdout.on("error", () => {});
    return this.handle(entry, false);
  }

  private end(entry: Entry, code: number): void {
    if (entry.ended) return;
    entry.ended = true;
    entry.exited = true;
    this.live.delete(entry);
    if (entry.timer) clearTimeout(entry.timer);
    const lastErr = entry.errTail.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
    for (const f of entry.exits) f(code, lastErr.slice(0, 120));
  }

  private handle(entry: Entry, reattached: boolean): Chat {
    let mine = true; // false once this handle is released or killed
    let replay = reattached; // a request left unanswered while nobody was looking is shown again
    const send = (o: unknown) => void (mine && !entry.exited && entry.proc.stdin.write(JSON.stringify(o) + "\n"));
    return {
      onEvent: (cb) => {
        entry.events.push(cb);
        if (!replay) return;
        replay = false;
        for (const e of entry.asks.values()) cb(e);
      },
      onExit: (cb) => void entry.exits.push(cb),
      say: (text) => send({ type: "user", message: { role: "user", content: text } }),
      answer: (id, allow) => {
        const ask = entry.asks.get(id);
        if (!ask) return;
        entry.asks.delete(id);
        send({
          type: "control_response",
          response: { subtype: "success", request_id: id, response: allow ? { behavior: "allow", updatedInput: (ask.request as { input?: unknown }).input } : { behavior: "deny", message: "Người dùng từ chối" } },
        });
      },
      interrupt: () => send({ type: "control_request", request_id: `int-${++entry.n}`, request: { subtype: "interrupt" } }),
      kill: () => {
        mine = false;
        this.stop(entry);
      },
      release: () => {
        if (!mine || entry.exited) return;
        mine = false;
        entry.attached = false;
        entry.events = [];
        entry.exits = [];
        entry.order = ++this.clock;
        entry.timer = setTimeout(() => this.stop(entry), this.parkMs);
        entry.timer.unref?.();
      },
      pending: (id) => mine && entry.asks.has(id),
    };
  }

  /** Frees the slot at once and ends the process: EOF first, the hard kill if it lingers. */
  private stop(entry: Entry): void {
    if (entry.exited) return;
    entry.exited = true;
    this.live.delete(entry);
    if (entry.timer) clearTimeout(entry.timer);
    entry.proc.stdin.end(); // claude exits 0 on EOF
    setTimeout(() => void (!entry.gone && this.force(entry.proc)), GRACE_MS).unref();
  }

  private evict(): boolean {
    let oldest: Entry | null = null;
    for (const e of this.live) if (!e.attached && (!oldest || e.order < oldest.order)) oldest = e;
    if (oldest) this.stop(oldest);
    return !!oldest;
  }

  /** Ends the session's parked process, if any: another kind of client is about to resume the same session. */
  drop(sessionId: string): void {
    for (const e of [...this.live]) if (e.sid === sessionId && !e.attached) this.stop(e);
  }

  killAll(): void {
    for (const e of [...this.live]) {
      if (!e.exited) this.force(e.proc);
      e.exited = true;
      if (e.timer) clearTimeout(e.timer);
      this.live.delete(e);
    }
  }
}
