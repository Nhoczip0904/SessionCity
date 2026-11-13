import { get } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/server/http.js";
import { Store } from "../src/server/store.js";
import type { Chat } from "../src/server/chat.js";

const TOKEN = "c".repeat(32);
const SID = "29b8e93b-ef21-47c9-b0e5-d293accee304";
const GONE = "39b8e93b-ef21-47c9-b0e5-d293accee304";

class FakeChat implements Chat {
  ev: (e: Record<string, unknown>) => void = () => {};
  exit: (c: number, e?: string) => void = () => {};
  calls: unknown[][] = [];
  known = new Set<string>(["r1"]);
  kills = 0;
  releases = 0;
  onEvent(cb: (e: Record<string, unknown>) => void) { this.ev = cb; }
  onExit(cb: (c: number, e: string) => void) { this.exit = (c, e) => cb(c, e ?? ""); }
  say(t: string) { this.calls.push(["say", t]); }
  answer(id: string, a: boolean) { this.calls.push(["answer", id, a]); }
  interrupt() { this.calls.push(["interrupt"]); }
  kill() { this.kills++; }
  release() { this.releases++; }
  pending(id: string) { return this.known.has(id); }
}

const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(f()).toBe(true);
};

describe("/chat websocket", () => {
  let d: string;
  let sv: { url: string; close(): Promise<void> };
  let p: number;
  let opens: [string, string][];
  let chat: FakeChat;
  let full = false;
  let boom = false;
  let killAlls = 0;
  let slow: Promise<void> | null = null;
  const busy = new Set<string>();
  const ptyBusy = new Set<string>();
  const ptyDrops: string[] = [];
  const watches: { sid: string; fire: () => void; stopped: boolean }[] = [];
  let items: object[] = [{ role: "user", text: "hello" }];
  beforeAll(async () => {
    d = await mkdtemp(join(tmpdir(), "http-chat-"));
    const st = new Store();
    st.apply({ kind: "meta", sessionId: SID, at: "2026-11-12T00:00:00Z", cwd: d });
    st.apply({ kind: "meta", sessionId: GONE, at: "2026-11-12T00:00:00Z", cwd: join(d, "deleted") });
    opens = [];
    sv = await startServer({
      port: 0, token: TOKEN, store: st, clientDir: d, claude: null, agentsDir: join(d, "a"), claudeDir: join(d, "c"),
      launcher: async () => {},
      chat: {
        open: (s, c) => {
          if (full) return null;
          if (boom) throw new Error("spawn failed");
          opens.push([s, c]);
          return (chat = new FakeChat());
        },
        killAll: () => void killAlls++,
        isOpen: (s) => busy.has(s),
        drop: () => {},
        watch: (sid, cb) => {
          const w = { sid, fire: cb, stopped: false };
          watches.push(w);
          return () => void (w.stopped = true);
        },
        history: async () => {
          await slow;
          return items as never;
        },
      },
      pty: { open: () => null, killAll: () => {}, isOpen: (s) => ptyBusy.has(s), drop: (s) => void ptyDrops.push(s) },
    });
    p = Number(new URL(sv.url).port);
  });
  afterAll(async () => {
    await sv.close();
    await rm(d, { recursive: true, force: true });
  });

  // Collects every frame from the first one on, so none are missed.
  const connect = (q: string, origin = `http://127.0.0.1:${p}`, token = true) =>
    new Promise<{ ws: WebSocket; frames: any[]; status?: number }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}/chat?${token ? `token=${TOKEN}&` : ""}${q}`, { headers: { Origin: origin } });
      const frames: any[] = [];
      ws.on("message", (m) => frames.push(JSON.parse(m.toString())));
      ws.on("open", () => ok({ ws, frames }));
      ws.on("unexpected-response", (_r, res) => ok({ ws, frames, status: res.statusCode }));
      ws.on("error", () => {});
    });

  it("rejects bad requests, and a throwing open answers 500 while the server stays up", async () => {
    opens.length = 0;
    expect((await connect(`session=${SID}`, undefined, false)).status).toBe(401);
    expect((await connect(`session=${SID}`, "http://evil.example")).status).toBe(403);
    expect((await connect("session=11111111-2222-3333-4444-555555555555")).status).toBe(404);
    expect((await connect("session=--help")).status).toBe(404);
    full = true;
    expect((await connect(`session=${SID}`)).status).toBe(503);
    full = false;
    expect(opens).toEqual([]);
    boom = true;
    expect((await connect(`session=${SID}`)).status).toBe(500);
    boom = false;
    const { ws } = await connect(`session=${SID}`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("uses the session cwd, or home when it is gone", async () => {
    (await connect(`session=${SID}`)).ws.close();
    expect(opens.at(-1)).toEqual([SID, d]);
    (await connect(`session=${GONE}`)).ws.close();
    expect(opens.at(-1)).toEqual([GONE, homedir()]);
  });

  it("sends history first, then relays events", async () => {
    const { ws, frames } = await connect(`session=${SID}`);
    await until(() => frames.length === 1);
    expect(frames[0]).toEqual({ t: "history", items: [{ role: "user", text: "hello" }] });
    chat.ev({ type: "x" });
    await until(() => frames.length === 2);
    expect(frames[1]).toEqual({ t: "ev", e: { type: "x" } });
    ws.close();
  });

  it("buffers events emitted while history loads", async () => {
    let release!: () => void;
    slow = new Promise<void>((r) => (release = r));
    const { ws, frames } = await connect(`session=${SID}`);
    chat.ev({ type: "early" });
    release();
    slow = null;
    await until(() => frames.length === 2);
    expect(frames.map((f) => f.t)).toEqual(["history", "ev"]);
    expect(frames[1].e).toEqual({ type: "early" });
    ws.close();
  });

  it("routes say/allow/deny/stop and ignores invalid frames", async () => {
    const { ws } = await connect(`session=${SID}`);
    const c = chat;
    ws.send(JSON.stringify({ t: "say", text: "hi" }));
    ws.send(JSON.stringify({ t: "say", text: "" }));
    ws.send(JSON.stringify({ t: "say", text: "x".repeat(100001) }));
    ws.send(JSON.stringify({ t: "say", text: 5 }));
    ws.send(JSON.stringify({ t: "allow", id: "r1" }));
    ws.send(JSON.stringify({ t: "deny", id: "r1" }));
    ws.send(JSON.stringify({ t: "allow", id: "nope" }));
    ws.send(JSON.stringify({ t: "deny", id: 7 }));
    ws.send("not json");
    ws.send(JSON.stringify({ t: "stop" }));
    await until(() => c.calls.length === 4);
    expect(c.calls).toEqual([["say", "hi"], ["answer", "r1", true], ["answer", "r1", false], ["interrupt"]]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("close releases the chat without killing it; exit closes with 4000 and the code", async () => {
    const a = await connect(`session=${SID}`);
    const t = chat;
    a.ws.close();
    await until(() => t.releases === 1);
    expect(t.kills).toBe(0);
    const b = await connect(`session=${SID}`);
    const closed = new Promise<[number, string]>((ok) => b.ws.on("close", (code, r) => ok([code, r.toString()])));
    chat.exit(3);
    expect(await closed).toEqual([4000, "3"]);
  });

  it("close() kills all chats", async () => {
    const before = killAlls;
    const s2 = await startServer({
      port: 0, token: TOKEN, store: new Store(), clientDir: d, claude: null, agentsDir: d, claudeDir: d,
      launcher: async () => {}, chat: { open: () => null, killAll: () => void killAlls++, isOpen: () => false, drop: () => {}, watch: () => () => {}, history: async () => [] },
    });
    await s2.close();
    expect(killAlls).toBe(before + 1);
  });

  it("ends a parked terminal of the session before opening the chat", async () => {
    ptyDrops.length = 0;
    const { ws } = await connect(`session=${SID}`);
    expect(ptyDrops).toEqual([SID]);
    ws.close();
  });

  it("sends the history again, marked as a sync, when the transcript changes; stops watching on close", async () => {
    watches.length = 0;
    const { ws, frames } = await connect(`session=${SID}`);
    await until(() => frames.some((f) => f.t === "history"));
    expect(watches.map((w) => w.sid)).toEqual([SID]);
    items = [{ role: "user", text: "hello" }, { role: "claude", text: "from elsewhere" }];
    watches[0].fire();
    await until(() => frames.some((f) => f.t === "history" && f.sync === true));
    expect(frames.find((f) => f.sync === true).items.at(-1).text).toBe("from elsewhere");
    ws.close();
    await until(() => watches[0].stopped);
    items = [{ role: "user", text: "hello" }];
  });

  it("accepts an uppercase session id", async () => {
    const { ws } = await connect(`session=${SID.toUpperCase()}`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("kills the chat when the handshake is invalid", async () => {
    const before = opens.length;
    await new Promise<void>((ok) => {
      get(`http://127.0.0.1:${p}/chat?token=${TOKEN}&session=${SID}`, {
        headers: { Origin: `http://127.0.0.1:${p}`, Connection: "Upgrade", Upgrade: "websocket" },
      }).on("upgrade", () => ok()).on("response", (r) => { r.resume(); ok(); }).on("error", () => ok());
    });
    expect(opens.length).toBe(before + 1);
    await until(() => chat.kills === 1);
  });

  it("409 when the session is already open in a chat or a terminal, before spawning", async () => {
    const before = opens.length;
    busy.add(SID);
    expect((await connect(`session=${SID}`)).status).toBe(409);
    busy.delete(SID);
    ptyBusy.add(SID);
    expect((await connect(`session=${SID}`)).status).toBe(409);
    ptyBusy.delete(SID);
    expect(opens.length).toBe(before);
  });

  it("the close reason is the exit code plus the last stderr line, within 123 bytes", async () => {
    const a = await connect(`session=${SID}`);
    const closed = new Promise<string>((ok) => a.ws.on("close", (_c, r) => ok(r.toString())));
    chat.exit(1, "boom");
    expect(await closed).toBe("1: boom");
    const b = await connect(`session=${SID}`);
    const long = new Promise<Buffer>((ok) => b.ws.on("close", (_c, r) => ok(r)));
    chat.exit(1, "Lỗi ".repeat(60));
    const r = await long;
    expect(r.length).toBeLessThanOrEqual(123);
    expect(r.toString().startsWith("1: Lỗi Lỗi")).toBe(true);
    expect(r.toString()).not.toContain("�");
  });
});
