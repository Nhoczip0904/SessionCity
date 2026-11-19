import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer } from "../src/server/http.js";
import { Store } from "../src/server/store.js";

const TOKEN = "c".repeat(32);
let dir: string, srv: { url: string; close(): Promise<void> }, base: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cookie-"));
  await writeFile(join(dir, "index.html"), "<h1>city</h1>");
  srv = await startServer({ port: 0, token: TOKEN, store: new Store(), clientDir: dir, claude: null, agentsDir: join(dir, "a"), claudeDir: join(dir, "c"), launcher: async () => {} });
  base = new URL(srv.url).origin;
});
afterAll(async () => {
  await srv.close();
  await rm(dir, { recursive: true, force: true });
});

const COOKIE = `sc=${TOKEN}`;

describe("token cookie", () => {
  it("the first visit with ?token= sets an HttpOnly cookie and redirects to a clean URL", async () => {
    const r = await fetch(`${base}/?token=${TOKEN}&x=1`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/?x=1");
    const c = r.headers.get("set-cookie")!;
    expect(c).toContain(COOKIE);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
  });
  it("a wrong token on the page is not redirected and sets no cookie", async () => {
    const r = await fetch(`${base}/?token=bad`, { redirect: "manual" });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("the API accepts the cookie, and rejects a wrong or missing one", async () => {
    expect((await fetch(`${base}/api/state`, { headers: { Cookie: COOKIE } })).status).toBe(200);
    expect((await fetch(`${base}/api/state`, { headers: { Cookie: "sc=nope" } })).status).toBe(401);
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
  });
  it("the WebSocket accepts the cookie", async () => {
    const open = (cookie?: string) =>
      new Promise<string>((res) => {
        const ws = new WebSocket(`ws://${new URL(base).host}/ws`, { headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}) } });
        ws.on("open", () => (ws.close(), res("open")));
        ws.on("unexpected-response", (_q, r) => res(String(r.statusCode)));
        ws.on("error", () => {});
      });
    expect(await open(COOKIE)).toBe("open");
    expect(await open()).toBe("401");
  });
});
