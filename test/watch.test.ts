import { mkdtemp, mkdir, writeFile, appendFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Watcher } from "../src/server/watch.js";
import type { Event } from "../src/shared/types.js";

let root: string;
let w: Watcher | undefined;
let events: Event[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "watch-"));
  events = [];
  w = undefined;
});
afterEach(async () => {
  w?.stop();
  await rm(root, { recursive: true, force: true });
});

const ts = () => new Date().toISOString();
const prompt = (text = "hi") => JSON.stringify({ type: "user", timestamp: ts(), message: { content: text } }) + "\n";
const tool = (name = "Read") =>
  JSON.stringify({ type: "assistant", timestamp: ts(), message: { id: "m", content: [{ type: "tool_use", id: "t1", name, input: {} }] } }) + "\n";
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(cond()).toBe(true);
};
const start = (opts = {}) => {
  w = new Watcher(root, (e) => events.push(...e), { intervalMs: 50, ...opts });
  return w.start();
};

describe("Watcher", () => {
  it("picks up a session file created after start within one scan", async () => {
    await start();
    await mkdir(join(root, "proj"));
    await writeFile(join(root, "proj", "sess1.jsonl"), prompt());
    await until(() => events.some((e) => e.kind === "prompt" && e.sessionId === "sess1"));
  });

  it("emits events for appended lines", async () => {
    await mkdir(join(root, "proj"));
    const f = join(root, "proj", "s2.jsonl");
    await writeFile(f, prompt());
    await start();
    await until(() => events.some((e) => e.kind === "prompt"));
    await appendFile(f, tool("Read"));
    await until(() => events.some((e) => e.kind === "tool" && e.name === "Read" && e.sessionId === "s2"));
    expect(events.filter((e) => e.kind === "prompt")).toHaveLength(1);
  });

  it("links subagent transcript lines to agentId and reads meta.json", async () => {
    const dir = join(root, "proj", "s3", "subagents");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "agent-abc.jsonl"), tool("Grep"));
    await writeFile(
      join(dir, "agent-abc.meta.json"),
      JSON.stringify({ agentType: "Explore", description: "look", toolUseId: "tu1" }),
    );
    await start();
    await until(() => events.some((e) => e.kind === "tool") && events.some((e) => e.kind === "agentMeta"));
    const t = events.find((e) => e.kind === "tool")!;
    expect(t).toMatchObject({ sessionId: "s3", agentId: "abc", name: "Grep" });
    expect(events.filter((e) => e.kind === "agentMeta")).toEqual([
      expect.objectContaining({ sessionId: "s3", agentId: "abc", toolUseId: "tu1", type: "Explore" }),
    ]);
  });

  it("retries meta.json when it appears later, and reads it once", async () => {
    const dir = join(root, "proj", "s4", "subagents");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "agent-z.jsonl"), tool());
    await start();
    await until(() => events.some((e) => e.kind === "tool"));
    expect(events.some((e) => e.kind === "agentMeta")).toBe(false);
    await writeFile(join(dir, "agent-z.meta.json"), JSON.stringify({ agentType: "X", description: "", toolUseId: "u" }));
    await until(() => events.some((e) => e.kind === "agentMeta"));
    await new Promise((r) => setTimeout(r, 200));
    expect(events.filter((e) => e.kind === "agentMeta")).toHaveLength(1);
  });

  it("ignores files older than maxAgeMs", async () => {
    await mkdir(join(root, "proj"));
    const old = join(root, "proj", "old.jsonl");
    await writeFile(old, prompt());
    const t = new Date(Date.now() - 48 * 3600_000);
    await utimes(old, t, t);
    await writeFile(join(root, "proj", "new.jsonl"), prompt());
    await start({ maxAgeMs: 24 * 3600_000 });
    await until(() => events.some((e) => e.sessionId === "new"));
    expect(events.some((e) => e.sessionId === "old")).toBe(false);
  });

  it("keeps scanning when the root is missing", async () => {
    await rm(root, { recursive: true, force: true });
    await start();
    await mkdir(join(root, "proj"), { recursive: true });
    await writeFile(join(root, "proj", "late.jsonl"), prompt());
    await until(() => events.some((e) => e.sessionId === "late"));
  });
});
