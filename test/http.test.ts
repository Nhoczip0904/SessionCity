import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer, tokenOk } from "../src/server/http.js";
import { Store } from "../src/server/store.js";
import { LaunchInputError, type LaunchOpts } from "../src/server/launch.js";

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
  srv = await startServer({ port: 0, token: TOKEN, store, clientDir: join(dir, "client"), claude: null, agentsDir: join(dir, "agents"), claudeDir: join(dir, "claude"), launcher: async () => {} });
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

const rawSocket = (data: string) =>
  new Promise<string>((res) => {
    let out = "";
    const s = connect(port, "127.0.0.1", () => s.write(data));
    s.on("data", (d) => (out += d));
    s.on("error", () => {});
    s.on("close", () => res(out));
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
  it("malformed request target -> 400 and server stays alive", async () => {
    for (const target of ["//", "//["]) {
      const reply = await rawSocket(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      expect(reply, target).toContain("HTTP/1.1 400");
      expect((await get(`/api/state?token=${TOKEN}`)).status).toBe(200);
    }
  });
  it("malformed upgrade URL -> socket closed and server stays alive", async () => {
    const reply = await rawSocket("GET //[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    expect(reply).not.toMatch(/101/);
    expect((await get(`/api/state?token=${TOKEN}`)).status).toBe(200);
  });
  it("invalid frame from a connected client does not crash the server", async () => {
    const { ws } = await wsOpen(`?token=${TOKEN}`, `http://127.0.0.1:${port}`);
    expect(ws).toBeDefined();
    const closed = new Promise((r) => ws!.once("close", r));
    (ws as any)._socket.write(Buffer.from([0xff, 0x00])); // RSV bits set, unmasked
    await closed;
    expect((await get(`/api/state?token=${TOKEN}`)).status).toBe(200);
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
    store.apply({ kind: "prompt", sessionId: "abcdef123456", at: new Date().toISOString(), text: "hi" });
    const end = Date.now() + 3000;
    while (!msgs.some((m) => m.type === "delta") && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    const d = msgs.find((m) => m.type === "delta");
    expect(d.delta.sessions[0].id).toBe("abcdef123456");
    ws!.close();
  });
});

describe("detail routes", () => {
  const AT = new Date().toISOString();
  const SID = "ses:detail1";
  const AID = "ag:detail1";
  beforeAll(() => {
    store.apply({ kind: "prompt", sessionId: SID, at: AT, text: "hello" });
    store.apply({ kind: "spawn", sessionId: SID, at: AT, toolUseId: "tuD", type: "Explore", description: "d", prompt: "p" });
    store.apply({ kind: "agentMeta", sessionId: SID, agentId: AID, toolUseId: "tuD", type: "Explore", description: "d", at: AT });
  });
  const q = (p: string) => get(`${p}${p.includes("?") ? "&" : "?"}token=${TOKEN}`);

  it("both routes -> 401 without token", async () => {
    expect((await get(`/api/session/${encodeURIComponent(SID)}`)).status).toBe(401);
    expect((await get(`/api/employee/${encodeURIComponent(AID)}`)).status).toBe(401);
  });
  it("unknown id -> 404 JSON", async () => {
    for (const p of ["/api/session/nope", "/api/employee/nope"]) {
      const r = await q(p);
      expect(r.status, p).toBe(404);
      expect(JSON.parse(r.body)).toEqual({ error: "not found" });
    }
  });
  it("known ids -> detail body, ':' sent as %3A resolves", async () => {
    const s = await q(`/api/session/${SID.replace(":", "%3A")}`);
    expect(s.status).toBe(200);
    expect(s.type).toContain("application/json");
    expect(JSON.parse(s.body)).toMatchObject({ id: SID, lastPrompt: "hello", steps: [] });
    const e = await q(`/api/employee/${AID.replace(":", "%3A")}`);
    expect(e.status).toBe(200);
    expect(JSON.parse(e.body)).toMatchObject({ id: AID, type: "Explore", steps: [], models: [] });
  });
  it("malformed encoding -> 400 JSON; extra segment -> 404", async () => {
    const bad = await q("/api/session/%E0%A4%A");
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)).toEqual({ error: "bad request" });
    expect((await q("/api/session/a/b")).status).toBe(404);
    expect((await q("/api/employee/")).status).toBe(404);
  });
});

describe("shelf routes", () => {
  const SID = "ses:shelf1";
  const q = (p: string) => get(`${p}?token=${TOKEN}`);
  beforeAll(async () => {
    await mkdir(join(dir, "claude"), { recursive: true });
    await writeFile(join(dir, "claude", "CLAUDE.md"), "hello shelf");
    store.apply({ kind: "meta", sessionId: SID, at: new Date().toISOString(), cwd: join(dir, "proj") });
  });

  it("401 without token, 404 unknown session", async () => {
    expect((await get(`/api/session/${encodeURIComponent(SID)}/shelf`)).status).toBe(401);
    expect((await q("/api/session/nope/shelf")).status).toBe(404);
  });

  it("lists files and reads a listed id; bad or unknown ids -> 404", async () => {
    const base = `/api/session/${encodeURIComponent(SID)}/shelf`;
    const list = JSON.parse((await q(base)).body);
    const user = list.files.find((f: any) => f.scope === "user");
    expect(user).toMatchObject({ size: 11 });
    const item = await q(`${base}/${user.id}`);
    expect(item.status).toBe(200);
    expect(JSON.parse(item.body)).toEqual({ text: "hello shelf", truncated: false });
    expect((await q(`${base}/..%2Fsecret.txt`)).status).toBe(404);
    expect((await q(`${base}/${"0".repeat(16)}`)).status).toBe(404);
  });
});

describe("launch + explore routes", () => {
  let d: string;
  let st: Store;
  let sv: { url: string; close(): Promise<void> };
  let p: number;
  let claude: string | null;
  let calls: LaunchOpts[];
  let launcher: (o: LaunchOpts) => Promise<void>;
  const okLauncher = async (o: LaunchOpts) => void calls.push(o);
  beforeAll(async () => {
    d = await mkdtemp(join(tmpdir(), "http-l-"));
    st = new Store();
    claude = "C:\\x\\claude.exe";
    calls = [];
    launcher = okLauncher;
    sv = await startServer({
      port: 0, token: TOKEN, store: st, clientDir: d,
      get claude() { return claude; }, agentsDir: join(d, "agents"), claudeDir: join(d, "claude"), launcher: (o) => launcher(o),
    });
    p = Number(new URL(sv.url).port);
  });
  afterAll(async () => {
    await sv.close();
    await rm(d, { recursive: true, force: true });
  });
  const ORIGIN = () => `http://127.0.0.1:${p}`;
  const call = (method: string, path: string, body: string, h: Record<string, string> = {}, token = true) =>
    fetch(`http://127.0.0.1:${p}${path}${token ? `?token=${TOKEN}` : ""}`, {
      method, body,
      headers: { Origin: ORIGIN(), "Content-Type": "application/json", ...h },
    }).then(async (r) => ({ status: r.status, body: await r.text() }));
  const gg = (path: string) => fetch(`http://127.0.0.1:${p}${path}`).then(async (r) => ({ status: r.status, body: await r.text() }));
  const state = () => fetch(`http://127.0.0.1:${p}/api/state?token=${TOKEN}`).then((r) => r.status);
  const launchBody = () => JSON.stringify({ cwd: d });

  it("launch without token -> 401", async () => {
    expect((await call("POST", "/api/launch", launchBody(), {}, false)).status).toBe(401);
  });
  it("launch wrong or missing Origin -> 403", async () => {
    expect((await call("POST", "/api/launch", launchBody(), { Origin: "http://evil.example" })).status).toBe(403);
    const r = await new Promise<number>((res, rej) => {
      const q = request({ host: "127.0.0.1", port: p, method: "POST", path: `/api/launch?token=${TOKEN}`, headers: { "Content-Type": "application/json" } }, (x) => { x.resume(); res(x.statusCode!); });
      q.on("error", rej); q.end(launchBody());
    });
    expect(r).toBe(403);
  });
  it("launch text/plain -> 415, launcher not called", async () => {
    const n = calls.length;
    expect((await call("POST", "/api/launch", launchBody(), { "Content-Type": "text/plain" })).status).toBe(415);
    expect(calls.length).toBe(n);
  });
  it("content-type params and case are accepted", async () => {
    const r = await call("POST", "/api/launch", launchBody(), { "Content-Type": "Application/JSON; charset=utf-8" });
    expect(r.status).toBe(202);
  });
  it("launch body 20 KB -> 413, server survives", async () => {
    expect((await call("POST", "/api/launch", JSON.stringify({ cwd: d, prompt: "a".repeat(20000) }))).status).toBe(413);
    expect(await state()).toBe(200);
  });
  it("client that keeps sending after 413 cannot crash the server", async () => {
    await new Promise<void>((res) => {
      const s = connect(p, "127.0.0.1", () => {
        s.write(`POST /api/launch?token=${TOKEN} HTTP/1.1\r\nHost: x\r\nOrigin: ${ORIGIN()}\r\nContent-Type: application/json\r\nContent-Length: 5000000\r\n\r\n`);
        const t = setInterval(() => s.write("x".repeat(8192)), 5);
        setTimeout(() => { clearInterval(t); s.destroy(); }, 300);
      });
      s.on("error", () => {});
      s.on("close", () => res());
    });
    expect(await state()).toBe(200);
  });
  it("launch bad JSON -> 400", async () => {
    const r = await call("POST", "/api/launch", "{nope");
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: "Dữ liệu không hợp lệ" });
  });
  it("launch relative cwd -> 400", async () => {
    expect((await call("POST", "/api/launch", JSON.stringify({ cwd: "rel/dir" }))).status).toBe(400);
  });
  it("launch valid -> 202 and launcher got opts", async () => {
    calls.length = 0;
    const r = await call("POST", "/api/launch", JSON.stringify({ cwd: d, model: "opus", prompt: "hi" }));
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(calls).toEqual([{ cwd: d, model: "opus", prompt: "hi" }]);
  });
  it("GET /api/launch -> 405", async () => {
    expect((await gg(`/api/launch?token=${TOKEN}`)).status).toBe(405);
  });
  it("claude null -> 409", async () => {
    claude = null;
    try {
      const r = await call("POST", "/api/launch", launchBody());
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body).error).toContain("winget install Anthropic.ClaudeCode");
    } finally {
      claude = "C:\\x\\claude.exe";
    }
  });
  it("launcher LaunchInputError -> 400 with message", async () => {
    launcher = async () => { throw new LaunchInputError("Đường dẫn chứa ký tự không an toàn"); };
    const r = await call("POST", "/api/launch", launchBody());
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: "Đường dẫn chứa ký tự không an toàn" });
    launcher = okLauncher;
  });
  it("launcher rejects -> 500, server still answers /api/state", async () => {
    launcher = async () => { throw new Error("spawn boom"); };
    const r = await call("POST", "/api/launch", launchBody());
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: "Không mở được terminal" });
    expect(await state()).toBe(200);
    launcher = okLauncher;
  });
  it("GET explore -> off; PUT on writes file; PUT off removes", async () => {
    expect(JSON.parse((await gg(`/api/agents/explore?token=${TOKEN}`)).body)).toEqual({ state: "off" });
    const on = await call("PUT", "/api/agents/explore", JSON.stringify({ enabled: true }));
    expect(on.status).toBe(200);
    expect(JSON.parse(on.body)).toEqual({ state: "on" });
    expect(await readFile(join(d, "agents", "Explore.md"), "utf8")).toContain("managed-by: BackendCity");
    const off = await call("PUT", "/api/agents/explore", JSON.stringify({ enabled: false }));
    expect(JSON.parse(off.body)).toEqual({ state: "off" });
  });
  it("explore fs failure (Explore.md is a directory) -> 500 for GET and PUT", async () => {
    await mkdir(join(d, "agents", "Explore.md"), { recursive: true });
    try {
      const g = await gg(`/api/agents/explore?token=${TOKEN}`);
      expect(g.status).toBe(500);
      expect(JSON.parse(g.body)).toEqual({ error: "Không đọc/ghi được Explore.md" });
      const r = await call("PUT", "/api/agents/explore", JSON.stringify({ enabled: false }));
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body)).toEqual({ error: "Không đọc/ghi được Explore.md" });
    } finally {
      await rm(join(d, "agents", "Explore.md"), { recursive: true });
    }
  });
  it("PUT explore non-boolean -> 400", async () => {
    expect((await call("PUT", "/api/agents/explore", JSON.stringify({ enabled: "yes" }))).status).toBe(400);
  });
  it("PUT explore on user-owned file -> 409", async () => {
    await mkdir(join(d, "agents"), { recursive: true });
    await writeFile(join(d, "agents", "Explore.md"), "mine");
    const r = await call("PUT", "/api/agents/explore", JSON.stringify({ enabled: true }));
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ error: "Bạn đã có Explore.md riêng — SessionCity không sửa file này" });
    expect(await readFile(join(d, "agents", "Explore.md"), "utf8")).toBe("mine");
    await rm(join(d, "agents", "Explore.md"));
  });
  it("PUT explore text/plain -> 415; wrong Origin -> 403; no token -> 401", async () => {
    const b = JSON.stringify({ enabled: true });
    expect((await call("PUT", "/api/agents/explore", b, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await call("PUT", "/api/agents/explore", b, { Origin: "http://evil.example" })).status).toBe(403);
    expect((await call("PUT", "/api/agents/explore", b, {}, false)).status).toBe(401);
  });
});

describe("PR board route", () => {
  it("needs the token, returns the PR list, and ?fresh=1 skips the cache", async () => {
    const calls: boolean[] = [];
    const s = await startServer({ port: 0, token: TOKEN, store, clientDir: join(dir, "client"), claude: null, agentsDir: join(dir, "agents"), claudeDir: join(dir, "claude"), launcher: async () => {},
      prs: async (fresh) => (calls.push(fresh), [{ repo: "r", prs: [] }]) });
    const base = s.url.replace(/\/\?.*$/, "").replace(/\/$/, "");
    try {
      expect((await fetch(`${base}/api/prs`)).status).toBe(401);
      const r = await fetch(`${base}/api/prs?token=${TOKEN}`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual([{ repo: "r", prs: [] }]);
      await fetch(`${base}/api/prs?token=${TOKEN}&fresh=1`);
      expect(calls).toEqual([false, true]);
    } finally {
      await s.close();
    }
  });

  it("without a PR source the board is empty", async () => {
    expect(JSON.parse((await get(`/api/prs?token=${TOKEN}`)).body)).toEqual([]);
  });
});
