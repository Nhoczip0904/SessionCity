import { StringDecoder } from "node:string_decoder";

export interface ChatProc {
  stdout: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
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
  onExit(cb: (code: number) => void): void;
  say(text: string): void;
  answer(requestId: string, allow: boolean): void;
  interrupt(): void;
  kill(): void;
  pending(requestId: string): boolean;
}

interface Entry {
  proc: ChatProc;
  exited: boolean;
}

export class ChatHub {
  private live = new Set<Entry>();
  constructor(
    private spawn: ChatSpawn,
    private claude: string | null,
    private max = 3,
  ) {}

  get size(): number {
    return this.live.size;
  }

  open(sessionId: string, cwd: string): Chat | null {
    if (!this.claude || this.live.size >= this.max) return null;
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--resume", sessionId, "--permission-prompts", "host", "--permission-prompt-tool", "stdio"];
    const proc = this.spawn(this.claude, args, { cwd, env: process.env, stdio: "pipe", windowsHide: true });
    const entry: Entry = { proc, exited: false };
    this.live.add(entry);
    const events: ((e: Record<string, unknown>) => void)[] = [];
    const exits: ((code: number) => void)[] = [];
    const inputs = new Map<string, unknown>(); // unanswered can_use_tool id -> original input
    let n = 0;
    proc.on("error", () => {}); // spawn/kill failures must not crash the server
    proc.stdin.on("error", () => {}); // EPIPE after exit
    proc.on("exit", (code) => {
      entry.exited = true;
      this.live.delete(entry);
      for (const f of exits) f(code ?? 1);
    });
    const dec = new StringDecoder("utf8");
    let buf = "";
    proc.stdout.on("data", (d: Buffer | string) => {
      buf += typeof d === "string" ? d : dec.write(d);
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        const r = e.request as { subtype?: string; input?: unknown } | undefined;
        if (e.type === "control_request" && r?.subtype === "can_use_tool" && typeof e.request_id === "string") inputs.set(e.request_id, r.input);
        for (const f of events) f(e);
      }
    });
    proc.stdout.on("error", () => {});
    const send = (o: unknown) => void (!entry.exited && proc.stdin.write(JSON.stringify(o) + "\n"));
    return {
      onEvent: (cb) => void events.push(cb),
      onExit: (cb) => void exits.push(cb),
      say: (text) => send({ type: "user", message: { role: "user", content: text } }),
      answer: (id, allow) => {
        if (!inputs.has(id)) return;
        const input = inputs.get(id);
        inputs.delete(id);
        send({
          type: "control_response",
          response: { subtype: "success", request_id: id, response: allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Người dùng từ chối" } },
        });
      },
      interrupt: () => send({ type: "control_request", request_id: `int-${++n}`, request: { subtype: "interrupt" } }),
      kill: () => {
        if (entry.exited) return;
        entry.exited = true;
        this.live.delete(entry); // free the slot now, as PtyHub does
        proc.kill();
      },
      pending: (id) => inputs.has(id),
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
