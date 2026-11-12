import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/server/http.js";
import { Store } from "../src/server/store.js";
import type { LaunchOpts } from "../src/server/launch.js";

const TOKEN = "b".repeat(32);
const SID = "29b8e93b-ef21-47c9-b0e5-d293accee304";

describe("POST /api/session/:id/resume reopens the session in a terminal", () => {
  let d: string;
  let sv: { url: string; close(): Promise<void> };
  let p: number;
  let calls: LaunchOpts[];
  let fail = false;
  beforeAll(async () => {
    d = await mkdtemp(join(tmpdir(), "http-d-"));
    const st = new Store();
    st.apply({ kind: "meta", sessionId: SID, at: "2026-11-12T00:00:00Z", cwd: d });
    calls = [];
    sv = await startServer({
      port: 0, token: TOKEN, store: st, clientDir: d, claude: null, agentsDir: join(d, "a"), claudeDir: join(d, "c"),
      launcher: async (o) => {
        if (fail) throw new Error("boom");
        calls.push(o);
      },
    });
    p = Number(new URL(sv.url).port);
  });
  afterAll(async () => {
    await sv.close();
    await rm(d, { recursive: true, force: true });
  });
  const post = (id: string, h: Record<string, string> = {}, token = true) =>
    fetch(`http://127.0.0.1:${p}/api/session/${encodeURIComponent(id)}/resume${token ? `?token=${TOKEN}` : ""}`, {
      method: "POST", body: "{}",
      headers: { Origin: `http://127.0.0.1:${p}`, "Content-Type": "application/json", ...h },
    }).then(async (r) => ({ status: r.status, body: await r.text() }));

  it("a known session: opens a terminal in its folder running claude --resume <id>", async () => {
    calls.length = 0;
    const r = await post(SID);
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ cwd: d, resume: SID }]);
  });
  it("unknown session -> 404, nothing runs", async () => {
    calls.length = 0;
    expect((await post("11111111-2222-3333-4444-555555555555")).status).toBe(404);
    expect(calls).toEqual([]);
  });
  it("an id that is not a session id shape -> 404, nothing runs", async () => {
    calls.length = 0;
    expect((await post("--help")).status).toBe(404);
    expect(calls).toEqual([]);
  });
  it("no token -> 401; foreign Origin -> 403; GET -> 405", async () => {
    calls.length = 0;
    expect((await post(SID, {}, false)).status).toBe(401);
    expect((await post(SID, { Origin: "http://evil.example" })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${p}/api/session/${SID}/resume?token=${TOKEN}`)).status).toBe(405);
    expect(calls).toEqual([]);
  });
  it("the terminal fails to start -> 500 with a Vietnamese message", async () => {
    fail = true;
    const r = await post(SID);
    fail = false;
    expect(r.status).toBe(500);
    expect(r.body).toContain("Không mở được terminal");
  });
});
