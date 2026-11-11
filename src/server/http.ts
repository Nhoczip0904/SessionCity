import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Store } from "./store.js";
import { LaunchInputError, validateLaunch, type LaunchOpts } from "./launch.js";
import { listShelf, readShelfItem } from "./shelf.js";
import { exploreState, setExplore, UserOwnedError } from "./agents.js";

const MAX_BODY = 16_384;

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

export async function startServer(opts: {
  port: number;
  token: string;
  store: Store;
  clientDir: string;
  claude: string | null;
  agentsDir: string;
  claudeDir: string;
  launcher: (opts: LaunchOpts) => Promise<void>;
}): Promise<{ url: string; close(): Promise<void> }> {
  const { token, store } = opts;
  const clientRoot = resolve(opts.clientDir);
  const wss = new WebSocketServer({ noServer: true });
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
    if (url.pathname !== "/ws") return reject(404, "Not Found");
    if (!tokenOk(token, url.searchParams.get("token"))) return reject(401, "Unauthorized");
    const origin = req.headers.origin;
    if (!origin || !origins.includes(origin)) return reject(403, "Forbidden");
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
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
