import { get } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/server/http.js";
import { Store } from "../src/server/store.js";
import type { Term } from "../src/server/pty.js";

const TOKEN = "c".repeat(32);
const SID = "29b8e93b-ef21-47c9-b0e5-d293accee304";
const GONE = "39b8e93b-ef21-47c9-b0e5-d293accee304";

class FakeTerm implements Term {
  data: (d: string) => void = () => {};
  exit: (c: number) => void = () => {};
  writes: string[] = [];
  sizes: [number, number][] = [];
  kills = 0;
  onData(cb: (d: string) => void) { this.data = cb; }
  onExit(cb: (c: number) => void) { this.exit = cb; }
  write(d: string) { this.writes.push(d); }
  resize(c: number, r: number) { this.sizes.push([c, r]); }
  kill() { this.kills++; }
}

const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(f()).toBe(true);
};

describe("/pty websocket", () => {
  let d: string;
  let sv: { url: string; close(): Promise<void> };
  let p: number;
  let opens: [string, string, number, number][];
  let term: FakeTerm;
  let full = false;
  let killAlls = 0;
  beforeAll(async () => {
    d = await mkdtemp(join(tmpdir(), "http-pty-"));
    const st = new Store();
    st.apply({ kind: "meta", sessionId: SID, at: "2026-11-12T00:00:00Z", cwd: d });
    st.apply({ kind: "meta", sessionId: GONE, at: "2026-11-12T00:00:00Z", cwd: join(d, "deleted") });
    opens = [];
    sv = await startServer({
      port: 0, token: TOKEN, store: st, clientDir: d, claude: null, agentsDir: join(d, "a"), claudeDir: join(d, "c"),
      launcher: async () => {},
      pty: {
        open: (s, c, cols, rows) => {
          if (full) return null;
          opens.push([s, c, cols, rows]);
          return (term = new FakeTerm());
        },
        killAll: () => void killAlls++,
      },
    });
    p = Number(new URL(sv.url).port);
  });
  afterAll(async () => {
    await sv.close();
    await rm(d, { recursive: true, force: true });
  });

  const connect = (q: string, origin = `http://127.0.0.1:${p}`, token = true) =>
    new Promise<{ ws: WebSocket; status?: number }>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}/pty?${token ? `token=${TOKEN}&` : ""}${q}`, { headers: { Origin: origin } });
      ws.on("open", () => ok({ ws }));
      ws.on("unexpected-response", (_r, res) => ok({ ws, status: res.statusCode }));
      ws.on("error", () => {});
    });

  it("rejects bad requests without opening a terminal", async () => {
    opens.length = 0;
    expect((await connect(`session=${SID}`, undefined, false)).status).toBe(401);
    expect((await connect(`session=${SID}`, "http://evil.example")).status).toBe(403);
    expect((await connect("session=11111111-2222-3333-4444-555555555555")).status).toBe(404);
    expect((await connect("session=--help")).status).toBe(404);
    full = true;
    expect((await connect(`session=${SID}`)).status).toBe(503);
    full = false;
    expect(opens).toEqual([]);
  });

  it("clamps size, defaults it, and uses the session cwd", async () => {
    const a = await connect(`session=${SID}&cols=5&rows=999`);
    expect(opens.at(-1)).toEqual([SID, d, 20, 200]);
    a.ws.close();
    const b = await connect(`session=${SID}`);
    expect(opens.at(-1)).toEqual([SID, d, 120, 32]);
    b.ws.close();
  });

  it("falls back to the home folder when the cwd is gone", async () => {
    const { ws } = await connect(`session=${GONE}`);
    expect(opens.at(-1)![1]).toBe(homedir());
    ws.close();
  });

  it("bridges input, resize, output, close and exit", async () => {
    const { ws } = await connect(`session=${SID}`);
    const t = term;
    ws.send(JSON.stringify({ t: "in", d: "Xin chào ✓" }));
    ws.send(JSON.stringify({ t: "size", cols: 1000, rows: 1 }));
    ws.send("nope");
    ws.send(JSON.stringify({ t: "in", d: 5 }));
    ws.send(JSON.stringify({ t: "x" }));
    await until(() => t.sizes.length === 1);
    expect(t.writes).toEqual(["Xin chào ✓"]);
    expect(t.sizes).toEqual([[400, 5]]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    const got = new Promise<string>((ok) => ws.once("message", (m) => ok(m.toString())));
    t.data("hi");
    expect(await got).toBe("hi");
    ws.close();
    await until(() => t.kills === 1);

    const c = await connect(`session=${SID}`);
    const closed = new Promise<[number, string]>((ok) => c.ws.on("close", (code, r) => ok([code, r.toString()])));
    term.exit(7);
    expect(await closed).toEqual([4000, "7"]);
  });

  it("close() kills all terminals", async () => {
    const s2 = await startServer({
      port: 0, token: TOKEN, store: new Store(), clientDir: d, claude: null, agentsDir: d, claudeDir: d,
      launcher: async () => {}, pty: { open: () => null, killAll: () => void killAlls++ },
    });
    await s2.close();
    expect(killAlls).toBe(1);
  });

  it("accepts an uppercase session id", async () => {
    const { ws } = await connect(`session=${SID.toUpperCase()}`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("kills the terminal when the handshake is invalid", async () => {
    const before = opens.length;
    await new Promise<void>((ok) => {
      get(`http://127.0.0.1:${p}/pty?token=${TOKEN}&session=${SID}`, {
        headers: { Origin: `http://127.0.0.1:${p}`, Connection: "Upgrade", Upgrade: "websocket" },
      }).on("upgrade", () => ok()).on("response", (r) => { r.resume(); ok(); }).on("error", () => ok());
    });
    expect(opens.length).toBe(before + 1);
    await until(() => term.kills === 1);
  });

  it("the old resume route is gone", async () => {
    const r = await fetch(`http://127.0.0.1:${p}/api/session/${SID}/resume?token=${TOKEN}`, {
      method: "POST", headers: { Origin: `http://127.0.0.1:${p}`, "Content-Type": "application/json" }, body: "{}",
    });
    expect(r.status).toBe(405);
  });
});
