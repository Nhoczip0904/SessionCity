import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/server/http.js";
import { notesFile } from "../src/server/notes.js";
import { Store } from "../src/server/store.js";

const TOKEN = "b".repeat(32);
let dir: string, srv: { url: string; close(): Promise<void> };
const api = (method: string, body?: unknown, token = TOKEN) =>
  fetch(`${new URL(srv.url).origin}/api/notes?token=${token}`, { method, headers: { Origin: new URL(srv.url).origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "notes-"));
  srv = await startServer({ port: 0, token: TOKEN, store: new Store(), clientDir: dir, claude: null, agentsDir: join(dir, "a"), claudeDir: join(dir, "c"), launcher: async () => {}, notes: notesFile(join(dir, "sub", "notes.json")) });
});
afterAll(async () => {
  await srv.close();
  await rm(dir, { recursive: true, force: true });
});

describe("/api/notes", () => {
  it("starts empty, saves to the JSON file, and drops bad entries", async () => {
    expect(await (await api("GET")).json()).toEqual({ notes: [] });
    const r = await api("PUT", { notes: [{ id: "a", x: 1, y: 2, text: "admin / pw", color: "evil" }, { nope: 1 }] });
    expect(r.status).toBe(200);
    expect(await (await api("GET")).json()).toEqual({ notes: [{ id: "a", x: 1, y: 2, text: "admin / pw", color: "#fff59d", pinned: true }] });
    expect(JSON.parse(await readFile(join(dir, "sub", "notes.json"), "utf8"))).toHaveLength(1);
  });
  it("rejects a bad body and a wrong token", async () => {
    expect((await api("PUT", { notes: "x" })).status).toBe(400);
    expect((await api("GET", undefined, "z".repeat(32))).status).toBe(401);
  });
});
