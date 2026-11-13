import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alerts, books, builds, flights, readOps, tests, type Op } from "../src/server/activity.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "act-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const line = (o: unknown) => JSON.stringify(o) + "\n";
const use = (at: string, id: string, name: string, input: object) =>
  line({ type: "assistant", timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const res = (at: string, id: string, content: unknown, isError = false) =>
  line({ type: "user", timestamp: at, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

describe("readOps", () => {
  it("pairs each tool call with its result and times it", async () => {
    const f = join(dir, "s.jsonl");
    await writeFile(f, use("2026-11-13T10:00:00.000Z", "a", "Bash", { command: "npm test" }) + res("2026-11-13T10:00:02.500Z", "a", "Tests  5 passed (5)"));
    expect(await readOps(f)).toEqual([
      { at: "2026-11-13T10:00:00.000Z", name: "Bash", input: { command: "npm test" }, text: "Tests  5 passed (5)", isError: false, ms: 2500 },
    ]);
  });

  it("reads text results given as blocks, flags errors, and keeps a call that has no result yet", async () => {
    const f = join(dir, "s.jsonl");
    await writeFile(f, use("2026-11-13T10:00:00Z", "a", "Read", { file_path: "x" }) + res("2026-11-13T10:00:01Z", "a", [{ type: "text", text: "boom" }], true) + use("2026-11-13T10:01:00Z", "b", "Bash", { command: "ls" }));
    const ops = await readOps(f);
    expect(ops[0]).toMatchObject({ text: "boom", isError: true });
    expect(ops[1]).toMatchObject({ name: "Bash", text: "", isError: false, ms: null });
  });

  it("returns nothing for a missing file or garbage lines", async () => {
    expect(await readOps(join(dir, "none.jsonl"))).toEqual([]);
    const f = join(dir, "g.jsonl");
    await writeFile(f, "not json\n{}\n");
    expect(await readOps(f)).toEqual([]);
  });

  it("cuts a long result", async () => {
    const f = join(dir, "s.jsonl");
    await writeFile(f, use("2026-11-13T10:00:00Z", "a", "Bash", { command: "x" }) + res("2026-11-13T10:00:01Z", "a", "y".repeat(50000)));
    expect((await readOps(f))[0].text.length).toBeLessThanOrEqual(4000);
  });
});

const op = (name: string, input: object, text = "", isError = false, at = "2026-11-13T10:00:00Z", ms: number | null = 1000): Op => ({ at, name, input, text, isError, ms });
const S = (project: string, ops: Op[]) => ({ project, ops });

describe("tests", () => {
  it("picks out test commands, with how they ended", () => {
    const runs = tests([S("api", [
      op("Bash", { command: "npx vitest run" }, "Test Files  3 passed (3)\n      Tests  454 passed | 2 skipped (456)"),
      op("Bash", { command: "ls" }, "x"),
      op("Bash", { command: "dotnet test" }, "Failed!  - Failed:     2, Passed:    11, Skipped:     0, Total:    13", true, "2026-11-13T11:00:00Z"),
      op("Read", { file_path: "x" }),
    ])]);
    expect(runs.map((r) => [r.command, r.ok, r.project])).toEqual([["dotnet test", false, "api"], ["npx vitest run", true, "api"]]); // newest first
    expect(runs[1].note).toBe("454 passed | 2 skipped (456)");
    expect(runs[0].note).toContain("Failed:     2");
    expect(runs[1].ms).toBe(1000);
  });

  it("an unfinished run has no verdict", () => {
    const [r] = tests([S("p", [op("Bash", { command: "pytest" }, "", false, "2026-11-13T10:00:00Z", null)])]);
    expect(r.ok).toBeNull();
  });

  it("counts a clean exit with failures in the output as failed", () => {
    const [r] = tests([S("p", [op("Bash", { command: "npm test" }, "Tests: 3 failed, 10 passed")])]);
    expect(r.ok).toBe(false);
  });

  it("keeps the 30 newest", () => {
    const many = Array.from({ length: 40 }, (_, i) => op("Bash", { command: "npm test" }, "ok", false, `2026-11-13T10:${String(i).padStart(2, "0")}:00Z`));
    expect(tests([S("p", many)]).length).toBe(30);
  });
});

describe("builds", () => {
  it("picks out build commands but not test runs, newest first", () => {
    const runs = builds([S("web", [
      op("Bash", { command: "npm run build" }, "built in 4s", false, "2026-11-13T10:00:00Z"),
      op("Bash", { command: "npm test" }, "ok"),
      op("Bash", { command: "dotnet build -c Release" }, "error CS1002", true, "2026-11-13T11:00:00Z"),
    ])]);
    expect(runs.map((r) => [r.command, r.ok])).toEqual([["dotnet build -c Release", false], ["npm run build", true]]);
  });
});

describe("flights", () => {
  it("lists pushes and deploys", () => {
    const f = flights([S("api", [
      op("Bash", { command: "git push origin main" }, "To github", false, "2026-11-13T10:00:00Z"),
      op("Bash", { command: "git status" }, ""),
      op("Bash", { command: "kubectl rollout status deploy/x" }, "", true, "2026-11-13T09:00:00Z"),
    ])]);
    expect(f.map((x) => [x.command, x.ok])).toEqual([["git push origin main", true], ["kubectl rollout status deploy/x", false]]);
  });
});

describe("alerts", () => {
  it("lists failed tool calls, newest first, one line each, without the user's refusals", () => {
    const a = alerts([
      S("api", [
        op("Bash", { command: "npm run lint" }, "line one\nline two", true, "2026-11-13T10:00:00Z"),
        op("Edit", {}, "The user doesn't want to proceed with this tool use.", true),
        op("Read", { file_path: "a" }, "fine", false),
      ]),
      S("web", [op("Grep", {}, "bad regex", true, "2026-11-13T12:00:00Z")]),
    ]);
    expect(a.map((x) => [x.project, x.tool, x.text])).toEqual([["web", "Grep", "bad regex"], ["api", "Bash", "line one"]]);
  });
});

describe("books", () => {
  it("counts reads per file across sessions, most read first", () => {
    const b = books([
      S("api", [op("Read", { file_path: "C:/r/a.ts" }), op("Read", { file_path: "C:/r/a.ts" }), op("Read", { file_path: "C:/r/b.ts" }), op("Bash", { command: "x" })]),
      S("web", [op("Read", { file_path: "C:/r/a.ts" })]),
    ]);
    expect(b.map((x) => [x.path, x.reads])).toEqual([["C:/r/a.ts", 3], ["C:/r/b.ts", 1]]);
  });

  it("keeps the 14 most read", () => {
    const ops = Array.from({ length: 20 }, (_, i) => op("Read", { file_path: `f${i}` }));
    expect(books([S("p", ops)]).length).toBe(14);
  });
});
