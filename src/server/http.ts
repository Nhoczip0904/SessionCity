import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Store } from "./store.js";

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

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return send(res, 400, "bad request");
    }
    if (req.method !== "GET") return send(res, 405, "method not allowed");
    if (url.pathname.startsWith("/api/")) {
      if (!tokenOk(token, url.searchParams.get("token"))) return send(res, 401, "unauthorized");
      if (url.pathname === "/api/state") return send(res, 200, JSON.stringify(store.snapshot()), TYPES[".json"]);
      const m = /^\/api\/(session|employee)\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const json = (status: number, body: unknown) => send(res, status, JSON.stringify(body), TYPES[".json"]);
        let id: string;
        try {
          id = decodeURIComponent(m[2]!);
        } catch {
          return json(400, { error: "bad request" });
        }
        const d = m[1] === "session" ? store.detailSession(id) : store.detailEmployee(id);
        return d ? json(200, d) : json(404, { error: "not found" });
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
