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
export interface ChatImage { media_type: string; data: string }
export interface Chat {
  onEvent(cb: (e: Record<string, unknown>) => void): void;
  onExit(cb: (code: number, lastErr: string) => void): void;
  /** `images` go before the text, as base64 with their media type. */
  say(text: string, images?: ChatImage[]): void;
  setModel(model: string): void;
  setMode(mode: string): void;
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
  modeReq: Map<string, string | undefined>; // set_permission_mode requests not yet answered, by id -> the mode before
  errTail: string;
  n: number;
  ended: boolean;
  busy: boolean; // a turn is running: said something, no result yet
}

/** The one line a permission question is shown as: the command, the file, or the input cut short. */
export function askSummary(input: unknown): string {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const pick = [o.command, o.file_path, o.path, o.url, o.pattern].find((v) => typeof v === "string" && v);
  const text = typeof pick === "string" ? pick : typeof input === "string" ? input : JSON.stringify(input ?? "");
  return text.replace(/\s+/g, " ").slice(0, 200);
}

const GRACE_MS = 2000;
const PARK_MS = 10 * 60_000; // a released process is kept this long
// claude.exe dies alone under ChildProcess.kill(); tool subprocesses it started would be orphaned
const taskkill = (pid: number) => void execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => {});

export class ChatHub {
  private live = new Set<Entry>();
  private mode: string | undefined; // the permission mode last chosen, for whichever session is opened next
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
    const entry: Entry = { sid: sessionId, proc, exited: false, gone: false, attached: true, timer: null, order: 0, events: [], exits: [], asks: new Map(), modeReq: new Map(), errTail: "", n: 0, ended: false, busy: false };
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
        if (e.type === "result" && !e.parent_tool_use_id) {
          entry.busy = false;
          if (!entry.attached && !entry.timer) this.park(entry); // the turn ended while nobody was looking
        }
        const r = e.request as { subtype?: string } | undefined;
        if (e.type === "control_request" && r?.subtype === "can_use_tool" && typeof e.request_id === "string") entry.asks.set(e.request_id, e);
        const cr = e.type === "control_response" ? (e.response as { subtype?: string; request_id?: string } | undefined) : undefined;
        if (cr?.request_id && entry.modeReq.has(cr.request_id)) {
          const before = entry.modeReq.get(cr.request_id);
          entry.modeReq.delete(cr.request_id);
          if (cr.subtype !== "success") {
            this.mode = before;
            for (const f of entry.events) f({ type: "mode", mode: before ?? "default" }); // refused: show the mode really in force
          }
        }
        for (const f of entry.events) f(e);
      }
    });
    proc.stdout.on("error", () => {});
    const chat = this.handle(entry, false);
    if (this.mode) chat.setMode(this.mode); // a fresh process starts in the default mode
    return chat;
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
        if (this.mode) cb({ type: "mode", mode: this.mode });
        if (!replay) return;
        replay = false;
        for (const e of entry.asks.values()) cb(e);
      },
      onExit: (cb) => void entry.exits.push(cb),
      say: (text, images = []) => {
        if (mine && !entry.exited) entry.busy = true;
        send({
          type: "user",
          message: { role: "user", content: images.length ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })), ...(text ? [{ type: "text", text }] : [])] : text },
        });
      },
      setModel: (model) => send({ type: "control_request", request_id: `mdl-${++entry.n}`, request: { subtype: "set_model", model } }),
      setMode: (mode) => {
        const id = `mode-${++entry.n}`;
        entry.modeReq.set(id, this.mode);
        this.mode = mode; // taken as in force until claude refuses it
        send({ type: "control_request", request_id: id, request: { subtype: "set_permission_mode", mode } });
      },
      answer: (id, allow) => void (mine && this.reply(entry, id, allow)),
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
        this.park(entry);
      },
      pending: (id) => mine && entry.asks.has(id),
    };
  }

  /** Stops a parked process after the park time, unless a turn is still running; the end of that turn parks it again. */
  private park(entry: Entry): void {
    if (entry.busy) return;
    entry.timer = setTimeout(() => this.stop(entry), this.parkMs);
    entry.timer.unref?.();
  }

  private reply(entry: Entry, id: string, allow: boolean): void {
    const ask = entry.asks.get(id);
    if (!ask) return;
    entry.asks.delete(id);
    if (entry.exited) return;
    entry.proc.stdin.write(
      JSON.stringify({
        type: "control_response",
        response: { subtype: "success", request_id: id, response: allow ? { behavior: "allow", updatedInput: (ask.request as { input?: unknown }).input } : { behavior: "deny", message: "Người dùng từ chối" } },
      }) + "\n",
    );
  }

  /** Permission questions nobody has answered yet, in every live process: attached to a chat window or parked. */
  asks(): { sid: string; id: string; tool: string; input: unknown }[] {
    const out: { sid: string; id: string; tool: string; input: unknown }[] = [];
    for (const e of this.live)
      for (const [id, a] of e.asks) {
        const r = a.request as { tool_name?: unknown; input?: unknown };
        out.push({ sid: e.sid, id, tool: typeof r.tool_name === "string" ? r.tool_name : "Tool", input: r.input });
      }
    return out;
  }

  /** Answers a question whether or not a chat window holds the process. False when no such question is waiting. */
  answerAsk(sessionId: string, id: string, allow: boolean): boolean {
    const e = [...this.live].find((x) => x.sid === sessionId && x.asks.has(id));
    if (!e) return false;
    this.reply(e, id, allow);
    return true;
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
    for (const e of this.live) if (!e.attached && !e.busy && (!oldest || e.order < oldest.order)) oldest = e;
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
