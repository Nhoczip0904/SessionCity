import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer, tokenOk } from "../src/server/http.js";
import { Store } from "../src/server/store.js";

const TOKEN = "a".repeat(32);
let dir: string;
let store: Store;
let srv: { url: string; close(): Promise<void> };
let port: number;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "http-"));
  await mkdir(join(dir, "client", "assets"), { recursive: true });
  await writeFile(join(dir, "client", "index.html"), "<h1>city</h1>");
  await writeFile(join(dir, "client", "assets", "app.js"), "1");
  await writeFile(join(dir, "secret.txt"), "nope");
  store = new Store();
  srv = await startServer({ port: 0, token: TOKEN, store, clientDir: join(dir, "client") });
  port = Number(new URL(srv.url).port);
});
afterAll(async () => {
  await srv.close();
  await rm(dir, { recursive: true, force: true });
});

const get = (path: string) =>
  fetch(`http://127.0.0.1:${port}${path}`).then(async (r) => ({
    status: r.status,
    type: r.headers.get("content-type"),
    body: await r.text(),
  }));
// fetch normalises "..", so send traversal paths with raw http
const raw = (path: string) =>
  new Promise<number>((res, rej) => {
    request({ host: "127.0.0.1", port, path }, (r) => {
      r.resume();
      res(r.statusCode!);
    })
      .on("error", rej)
      .end();
  });

const wsOpen = (query: string, origin?: string, msgs: any[] = []) =>
  new Promise<{ ws?: WebSocket; status?: number }>((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, origin ? { origin } : {});
    ws.on("message", (d) => msgs.push(JSON.parse(String(d)))); // attach before open: state is sent immediately
    ws.once("open", () => res({ ws }));
    ws.once("unexpected-response", (_q, r) => {
      r.resume();
      res({ status: r.statusCode });
    });
    ws.once("error", () => {});
  });

describe("http", () => {
  it("GET /api/state without token -> 401", async () => {
    expect((await get("/api/state")).status).toBe(401);
    expect((await get("/api/state?token=wrong")).status).toBe(401);
  });
  it("GET /api/state with token -> JSON state", async () => {
    const r = await get(`/api/state?token=${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.type).toContain("application/json");
    expect(JSON.parse(r.body)).toEqual({ sessions: [], employees: [] });
  });
  it("tokenOk is exact and length safe", () => {
    expect(tokenOk(TOKEN, TOKEN)).toBe(true);
    expect(tokenOk(TOKEN, TOKEN.slice(1))).toBe(false);
    expect(tokenOk(TOKEN, "b".repeat(32))).toBe(false);
    expect(tokenOk(TOKEN, null)).toBe(false);
  });
  it("serves index and assets without token with content types", async () => {
    const i = await get("/");
    expect(i.status).toBe(200);
    expect(i.type).toContain("text/html");
    expect(i.body).toContain("city");
    const a = await get("/assets/app.js");
    expect(a.status).toBe(200);
    expect(a.type).toContain("javascript");
  });
  it("path traversal -> 404", async () => {
    for (const p of [
      "/../secret.txt",
      "/..%2fsecret.txt",
      "/%2e%2e/secret.txt",
      "/..%5csecret.txt",
      "/assets/../../secret.txt",
      "//etc/passwd",
      "/%00",
    ])
      expect(await raw(p), p).toBe(404);
  });
  it("unknown path -> 404", async () => {
    expect((await get("/nope.js")).status).toBe(404);
  });
  it("WS without token -> 401", async () => {
    expect((await wsOpen("", `http://127.0.0.1:${port}`)).status).toBe(401);
  });
  it("WS with wrong Origin -> 403", async () => {
    expect((await wsOpen(`?token=${TOKEN}`, "http://evil.example")).status).toBe(403);
    expect((await wsOpen(`?token=${TOKEN}`, `http://127.0.0.1:${port + 1}`)).status).toBe(403);
  });
  it("WS with missing Origin -> 403", async () => {
    expect((await wsOpen(`?token=${TOKEN}`)).status).toBe(403);
  });
  it("WS with token+origin receives state then delta after a store change", async () => {
    const msgs: any[] = [];
    const { ws } = await wsOpen(`?token=${TOKEN}`, `http://localhost:${port}`, msgs);
    expect(ws).toBeDefined();
    await new Promise((r) => setTimeout(r, 100));
    expect(msgs[0]).toMatchObject({ type: "state", state: { sessions: [], employees: [] } });
    store.apply({ kind: "prompt", sessionId: "abcdef123456", at: new Date().toISOString() });
    const end = Date.now() + 3000;
    while (!msgs.some((m) => m.type === "delta") && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    const d = msgs.find((m) => m.type === "delta");
    expect(d.delta.sessions[0].id).toBe("abcdef123456");
    ws!.close();
  });
});
