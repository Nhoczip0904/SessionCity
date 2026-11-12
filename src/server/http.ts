import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Store } from "./store.js";
import { LaunchInputError, validateLaunch, type LaunchOpts } from "./launch.js";
import { listShelf, readShelfItem } from "./shelf.js";
import type { Term } from "./pty.js";
import type { Chat } from "./chat.js";
import type { HistoryItem } from "./history.js";
import { exploreState, setExplore, UserOwnedError } from "./agents.js";

const MAX_BODY = 16_384;
const SESSION_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const clampSize = (v: string | null, def: number, min: number, max: number): number => {
  const n = Number(v);
  return v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.round(n)));
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export function tokenOk(expected: string, given: string | null): boolean {
  if (given === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// a close reason may be at most 123 UTF-8 bytes; cut on a character boundary
function reason(code: number, err: string): string {
  let r = "";
  let n = 0;
  for (const ch of String(code) + (err ? ": " + err : "")) {
    n += Buffer.byteLength(ch);
    if (n > 123) break;
    r += ch;
  }
  return r;
}

export async function startServer(opts: {
  port: number;
  token: string;
  store: Store;
  clientDir: string;
  claude: string | null;
  agentsDir: string;
  claudeDir: string;
  launcher: (opts: LaunchOpts) => Promise<void>;
  pty?: { open(sessionId: string, cwd: string, cols: number, rows: number): Term | null; killAll(): void; isOpen(sessionId: string): boolean };
  chat?: { open(sessionId: string, cwd: string): Chat | null; killAll(): void; isOpen(sessionId: string): boolean; history(sessionId: string): Promise<HistoryItem[]> };
}): Promise<{ url: string; close(): Promise<void> }> {
  const { token, store } = opts;
  const clientRoot = resolve(opts.clientDir);
  const wss = new WebSocketServer({ noServer: true });
  const ptyWss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  const chatWss = new WebSocketServer({ noServer: true, maxPayload: 262144 });
  let origins: string[] = [];

  const send = (res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };

  async function serveStatic(pathname: string, res: ServerResponse) {
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return send(res, 404, "not found");
    }
    if (rel === "/") rel = "/index.html";
    if (rel.includes("\0") || rel.split(/[\\/]/).includes("..")) return send(res, 404, "not found");
    const file = resolve(clientRoot, "." + rel);
    const type = TYPES[extname(file).toLowerCase()];
    if (!file.startsWith(clientRoot + sep) || !type) return send(res, 404, "not found");
    try {
      send(res, 200, (await readFile(file)) as unknown as string, type);
    } catch {
      send(res, 404, "not found");
    }
  }

  const json = (res: ServerResponse, status: number, body: unknown) => send(res, status, JSON.stringify(body), TYPES[".json"]);

  // Reads at most MAX_BODY bytes; null means too large (request already answered 413 and destroyed).
  function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
    return new Promise((ok) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          req.removeAllListeners("data");
          chunks.length = 0;
          res.writeHead(413, { "Content-Type": TYPES[".json"], "Connection": "close" });
          res.end(JSON.stringify({ error: "Dữ liệu quá lớn" }), () => req.destroy());
          return ok(null);
        }
        chunks.push(c);
      });
      req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => ok(null));
    });
  }

  // Common gate for POST/PUT: Origin, Content-Type, body, JSON. Returns parsed body or undefined (already answered).
  async function readJson(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const origin = req.headers.origin;
    if (!origin || !origins.includes(origin)) return void json(res, 403, { error: "Nguồn không được phép" });
    if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? ""))
      return void json(res, 415, { error: "Content-Type phải là application/json" });
    const text = await readBody(req, res);
    if (text === null) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return void json(res, 400, { error: "Dữ liệu không hợp lệ" });
    }
  }

  const isDir = (p: string) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  async function launchRoute(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req, res);
    if (body === undefined || res.headersSent) return;
    const v = validateLaunch(body, isDir);
    if (!v.ok) return json(res, 400, { error: v.error });
    if (opts.claude === null) return json(res, 409, { error: "Chưa cài Claude Code CLI — chạy: winget install Anthropic.ClaudeCode" });
    try {
      await opts.launcher(v.opts);
    } catch (e) {
      if (e instanceof LaunchInputError) return json(res, 400, { error: e.message });
      return json(res, 500, { error: "Không mở được terminal" });
    }
    json(res, 202, { ok: true });
  }

  async function exploreRoute(req: IncomingMessage, res: ServerResponse) {
    let enabled: boolean | undefined;
    if (req.method === "PUT") {
      const body = await readJson(req, res);
      if (body === undefined || res.headersSent) return;
      const e = (body as { enabled?: unknown } | null)?.enabled;
      if (typeof e !== "boolean") return json(res, 400, { error: "Dữ liệu không hợp lệ" });
      enabled = e;
    }
    try {
      json(res, 200, { state: enabled === undefined ? exploreState(opts.agentsDir) : setExplore(opts.agentsDir, enabled) });
    } catch (e) {
      if (e instanceof UserOwnedError) return json(res, 409, { error: "Bạn đã có Explore.md riêng — BackendCity không sửa file này" });
      json(res, 500, { error: "Không đọc/ghi được Explore.md" });
    }
  }

  async function shelfRoute(res: ServerResponse, sessionId: string, itemId: string | undefined) {
    try {
      const s = store.detailSession(sessionId);
      if (!s) return json(res, 404, { error: "not found" });
      const cwd = s.cwd || undefined;
      if (itemId === undefined) return json(res, 200, await listShelf(cwd, opts.claudeDir, store.skillsUsed(sessionId)));
      if (!/^[0-9a-f]{16}$/.test(itemId)) return json(res, 404, { error: "not found" });
      const r = await readShelfItem(cwd, opts.claudeDir, itemId);
      json(res, r ? 200 : 404, r ?? { error: "not found" });
    } catch {
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return send(res, 400, "bad request");
    }
    const api = url.pathname.startsWith("/api/");
    const allowed = url.pathname === "/api/launch" ? ["POST"] : url.pathname === "/api/agents/explore" ? ["GET", "PUT"] : ["GET"];
    if (!allowed.includes(req.method ?? "")) return send(res, 405, "method not allowed");
    if (api) {
      if (!tokenOk(token, url.searchParams.get("token"))) return send(res, 401, "unauthorized");
      if (url.pathname === "/api/launch") return void launchRoute(req, res);
      if (url.pathname === "/api/agents/explore") return void exploreRoute(req, res);
      if (url.pathname === "/api/state") return send(res, 200, JSON.stringify(store.snapshot()), TYPES[".json"]);
      const sh = /^\/api\/session\/([^/]+)\/shelf(?:\/([^/]+))?$/.exec(url.pathname);
      if (sh) {
        let sid: string, item: string | undefined;
        try {
          sid = decodeURIComponent(sh[1]!);
          item = sh[2] === undefined ? undefined : decodeURIComponent(sh[2]);
        } catch {
          return json(res, 400, { error: "bad request" });
        }
        return void shelfRoute(res, sid, item);
      }
      const m = /^\/api\/(session|employee)\/([^/]+)$/.exec(url.pathname);
      if (m) {
        let id: string;
        try {
          id = decodeURIComponent(m[2]!);
        } catch {
          return json(res, 400, { error: "bad request" });
        }
        const d = m[1] === "session" ? store.detailSession(id) : store.detailEmployee(id);
        return d ? json(res, 200, d) : json(res, 404, { error: "not found" });
      }
      return send(res, 404, "not found");
    }
    void serveStatic(url.pathname, res);
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => {}); // reply can hit ECONNRESET; nothing else listens after 'upgrade'
    const reject = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return socket.destroy();
    }
    if (url.pathname !== "/ws" && url.pathname !== "/pty" && url.pathname !== "/chat") return reject(404, "Not Found");
    if (!tokenOk(token, url.searchParams.get("token"))) return reject(401, "Unauthorized");
    const origin = req.headers.origin;
    if (!origin || !origins.includes(origin)) return reject(403, "Forbidden");
    if (url.pathname === "/chat") {
      const sid = (url.searchParams.get("session") ?? "").toLowerCase();
      const s = SESSION_ID.test(sid) ? store.detailSession(sid) : undefined;
      const hub = opts.chat;
      if (!s || !hub) return reject(404, "Not Found");
      if (hub.isOpen(sid) || opts.pty?.isOpen(sid)) return reject(409, "Conflict"); // a second claude on one session forks the transcript
      let chat;
      try {
        chat = hub.open(sid, s.cwd && isDir(s.cwd) ? s.cwd : homedir());
      } catch {
        return reject(500, "Internal Server Error");
      }
      if (!chat) return reject(503, "Service Unavailable");
      let up = false;
      chatWss.handleUpgrade(req, socket, head, (ws) => {
        up = true;
        ws.on("error", () => {});
        // History is async: subscribe now, queue what claude emits until history is sent, then flush in order.
        let queue: (() => void)[] | null = [];
        const run = (f: () => void) => (queue ? void queue.push(f) : f());
        const out = (o: unknown) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
        };
        chat.onEvent((e) => run(() => out({ t: "ev", e })));
        chat.onExit((code, err) => run(() => ws.close(4000, reason(code, err))));
        ws.on("close", () => chat.kill());
        void hub.history(sid).catch((): HistoryItem[] => []).then((items) => {
          out({ t: "history", items });
          const q = queue!;
          queue = null;
          q.forEach((f) => f());
        });
        ws.on("message", (raw) => {
          let m: { t?: unknown; text?: unknown; id?: unknown };
          try {
            m = JSON.parse(raw.toString());
          } catch {
            return;
          }
          try {
            if (m?.t === "say" && typeof m.text === "string" && m.text.length > 0 && m.text.length <= 100000) chat.say(m.text);
            else if ((m?.t === "allow" || m?.t === "deny") && typeof m.id === "string" && chat.pending(m.id)) chat.answer(m.id, m.t === "allow");
            else if (m?.t === "stop") chat.interrupt();
          } catch {
            // the process may have exited; the 4000 close follows
          }
        });
      });
      if (!up) chat.kill(); // invalid handshake: ws aborted without calling back
      return;
    }
    if (url.pathname === "/pty") {
      const sid = (url.searchParams.get("session") ?? "").toLowerCase(); // store ids are lowercase
      const s = SESSION_ID.test(sid) ? store.detailSession(sid) : undefined; // the id goes on a command line
      if (!s || !opts.pty) return reject(404, "Not Found");
      if (opts.pty.isOpen(sid) || opts.chat?.isOpen(sid)) return reject(409, "Conflict");
      let term;
      try {
        term = opts.pty.open(
          sid,
          s.cwd && isDir(s.cwd) ? s.cwd : homedir(),
          clampSize(url.searchParams.get("cols"), 120, 20, 400),
          clampSize(url.searchParams.get("rows"), 32, 5, 200),
        );
      } catch {
        return reject(500, "Internal Server Error"); // conpty throws when CreateProcess fails; must not kill the server
      }
      if (!term) return reject(503, "Service Unavailable");
      let up = false;
      ptyWss.handleUpgrade(req, socket, head, (ws) => {
        up = true;
        ws.on("error", () => {});
        term.onData((d) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(d);
        });
        term.onExit((code) => ws.close(4000, String(code)));
        ws.on("close", () => term.kill());
        ws.on("message", (raw) => {
          let m: { t?: unknown; d?: unknown; cols?: unknown; rows?: unknown };
          try {
            m = JSON.parse(raw.toString());
          } catch {
            return;
          }
          try {
            if (m?.t === "in" && typeof m.d === "string") term.write(m.d);
            else if (m?.t === "size" && typeof m.cols === "number" && typeof m.rows === "number")
              term.resize(clampSize(String(m.cols), 120, 20, 400), clampSize(String(m.rows), 32, 5, 200));
          } catch {
            // node-pty throws on a pty that exited before onExit fired; the 4000 close follows
          }
        });
      });
      if (!up) term.kill(); // invalid handshake: ws aborted without calling back (the callback is synchronous)
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => {}); // invalid frame / oversized payload: ws closes the socket itself
      ws.send(JSON.stringify({ type: "state", state: store.snapshot() }));
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port, "127.0.0.1", ok);
  });
  const port = (server.address() as AddressInfo).port;
  origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

  const timers = [
    setInterval(() => {
      const delta = store.drainDelta();
      if (!delta) return;
      const msg = JSON.stringify({ type: "delta", delta });
      for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
    }, 250),
    setInterval(() => store.tick(), 1000),
  ];

  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    async close() {
      timers.forEach(clearInterval);
      for (const c of wss.clients) c.terminate();
      wss.close();
      for (const c of ptyWss.clients) c.terminate();
      ptyWss.close();
      for (const c of chatWss.clients) c.terminate();
      chatWss.close();
      opts.pty?.killAll();
      opts.chat?.killAll();
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
