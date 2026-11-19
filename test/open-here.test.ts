import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/server/http.js";
import { Store } from "../src/server/store.js";

describe("/api/session/:id/open", () => {
  const TOKEN = "e".repeat(32);
  const SID = "29b8e93b-ef21-47c9-b0e5-d293accee304";
  let d: string, srv: { url: string; close(): Promise<void> }, port: number;
  const opened: [string, string][] = [];
  beforeAll(async () => {
    d = await mkdtemp(join(tmpdir(), "open-"));
    const store = new Store();
    store.apply({ kind: "meta", sessionId: SID, at: new Date().toISOString(), cwd: d });
    srv = await startServer({
      port: 0, token: TOKEN, store, clientDir: d, claude: null, agentsDir: join(d, "a"), claudeDir: join(d, "c"), launcher: async () => {},
      opener: (cwd, what) => void opened.push([cwd, what]),
    });
    port = Number(new URL(srv.url).port);
  });
  afterAll(async () => {
    await srv.close();
    await rm(d, { recursive: true, force: true });
  });
  const post = (id: string, body: unknown, token = true, origin = `http://127.0.0.1:${port}`) =>
    fetch(`http://127.0.0.1:${port}/api/session/${id}/open${token ? `?token=${TOKEN}` : ""}`, { method: "POST", body: JSON.stringify(body), headers: { Origin: origin, "Content-Type": "application/json" } });

  it("opens cmd and the folder at the session's own cwd, never one the client names", async () => {
    expect((await post(SID, { what: "cmd", cwd: "C:\Windows" })).status).toBe(202);
    expect((await post(SID, { what: "folder" })).status).toBe(202);
    expect(opened).toEqual([[d, "cmd"], [d, "folder"]]);
  });
  it("opens a listed shelf file by id, never a path the client names", async () => {
    const file = join(d, "CLAUDE.md");
    await writeFile(file, "hi");
    const shelf = await (await fetch(`http://127.0.0.1:${port}/api/session/${SID}/shelf?token=${TOKEN}`)).json();
    const id = shelf.files.find((f: { path: string }) => f.path === file).id;
    const at = (item: string) => fetch(`http://127.0.0.1:${port}/api/session/${SID}/shelf/${item}/open?token=${TOKEN}`, { method: "POST", headers: { Origin: `http://127.0.0.1:${port}` } });
    const before = opened.length;
    expect((await at(id)).status).toBe(202);
    expect(opened.slice(before)).toEqual([[file, "file"]]);
    expect((await at("0".repeat(16))).status).toBe(404);
    expect((await at("..%2Fx")).status).toBe(404);
    expect(opened.length).toBe(before + 1);
  });
  it("400 for another action, 404 for an unknown session, 401 without token, 403 foreign origin", async () => {
    expect((await post(SID, { what: "rm" })).status).toBe(400);
    expect((await post("11111111-1111-1111-1111-111111111111", { what: "cmd" })).status).toBe(404);
    expect((await post(SID, { what: "cmd" }, false)).status).toBe(401);
    expect((await post(SID, { what: "cmd" }, true, "http://evil.example")).status).toBe(403);
    expect(opened.length).toBe(3); // the cmd, the folder and the shelf file above
  });
});
