import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bgJobs } from "../src/server/history.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bg-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const NOW = Date.parse("2026-11-18T10:00:00Z");
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const line = (o: unknown) => JSON.stringify(o) + "\n";
const start = (id: string, command: string, minAgo: number, bg = true) =>
  line({ type: "assistant", timestamp: at(minAgo), message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command, ...(bg ? { run_in_background: true } : {}) } }] } });
const launched = (id: string, task: string, minAgo: number) =>
  line({ type: "user", timestamp: at(minAgo), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `Command running in background with ID: ${task}. Output is being written to: /tmp/${task}.output` }] } });
const notice = (task: string, status: string, minAgo: number) =>
  line({ type: "user", timestamp: at(minAgo), message: { role: "user", content: `<task-notification>\n<task-id>${task}</task-id>\n<status>${status}</status>\n</task-notification>` } });
const jobs = async (body: string) => {
  const f = join(dir, "s.jsonl");
  await writeFile(f, body);
  return bgJobs(f, NOW);
};

describe("bgJobs", () => {
  it("a background Bash with no notice is running", async () => {
    expect(await jobs(start("t1", "npm test", 2) + launched("t1", "b1", 2))).toEqual([{ id: "b1", cmd: "npm test", start: NOW - 120_000 }]);
  });

  it("a foreground Bash is not a job", async () => {
    expect(await jobs(start("t1", "ls", 2, false) + launched("t1", "b1", 2))).toEqual([]);
  });

  it("a completed notice ends it, ok true", async () => {
    const [j] = await jobs(start("t1", "npm test", 5) + launched("t1", "b1", 5) + notice("b1", "completed", 1));
    expect(j).toMatchObject({ id: "b1", ok: true, end: NOW - 60_000 });
  });

  it("failed and killed are ok false", async () => {
    const body = start("t1", "a", 5) + launched("t1", "b1", 5) + notice("b1", "failed", 1) + start("t2", "b", 5) + launched("t2", "b2", 5) + notice("b2", "killed", 1);
    expect((await jobs(body)).map((j) => j.ok)).toEqual([false, false]);
  });

  it("drops a job finished more than 10 minutes ago", async () => {
    expect(await jobs(start("t1", "x", 30) + launched("t1", "b1", 30) + notice("b1", "completed", 20))).toEqual([]);
  });

  it("drops a running job older than 30 minutes (lost)", async () => {
    expect(await jobs(start("t1", "x", 40) + launched("t1", "b1", 40))).toEqual([]);
  });

  it("a job started but not yet acknowledged is still listed", async () => {
    expect(await jobs(start("t1", "npm test", 1))).toEqual([{ id: "t1", cmd: "npm test", start: NOW - 60_000 }]);
  });
});
