import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRules } from "../src/server/classify.js";
import { parseLine, parseMeta } from "../src/server/parse.js";

const rules = loadRules(JSON.parse(readFileSync("config/districts.json", "utf8")));
const ctx = { sessionId: "s1" };
const T = "2026-11-09T10:00:00.000Z";
const line = (o: object) => JSON.stringify({ timestamp: T, ...o });
const asst = (content: unknown[], extra: Record<string, unknown> = {}, id = "msg_1") =>
  line({ type: "assistant", message: { id, model: "claude-x", content, ...extra } });

describe("at on meta/usage", () => {
  it("meta and usage carry the record timestamp", () => {
    const usage = { input_tokens: 1, output_tokens: 2 };
    const l = line({ cwd: "/a/p", type: "assistant", message: { id: "m", model: "x", content: [], usage } });
    const ev = parseLine(l, ctx, rules);
    expect(ev.filter((e) => e.kind === "meta" || e.kind === "usage").map((e) => (e as { at: string }).at)).toEqual([T, T]);
  });
});

describe("parseLine", () => {
  it("user text → prompt", () => {
    const l = line({ type: "user", message: { role: "user", content: "hello" } });
    expect(parseLine(l, ctx, rules)).toEqual([{ kind: "prompt", sessionId: "s1", at: T }]);
    const b = line({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
    expect(parseLine(b, ctx, rules)).toEqual([{ kind: "prompt", sessionId: "s1", at: T }]);
  });

  it("isMeta user and subagent user are not prompts", () => {
    const l = line({ type: "user", isMeta: true, message: { content: "x" } });
    expect(parseLine(l, ctx, rules)).toEqual([]);
    const u = line({ type: "user", message: { content: "x" } });
    expect(parseLine(u, { sessionId: "s1", agentId: "a1" }, rules)).toEqual([]);
  });

  it("assistant Read tool_use → tool in library", () => {
    const l = asst([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }]);
    expect(parseLine(l, ctx, rules)).toEqual([
      { kind: "tool", sessionId: "s1", at: T, name: "Read", input: { file_path: "a.ts" }, district: "library" },
    ]);
  });

  it("assistant Agent tool_use → tool + spawn with prompt/description/type", () => {
    const input = { description: "d", subagent_type: "Explore", prompt: "p" };
    const ev = parseLine(asst([{ type: "tool_use", id: "t2", name: "Agent", input }]), ctx, rules);
    expect(ev.map((e) => e.kind)).toEqual(["tool", "spawn"]);
    expect(ev[1]).toEqual({
      kind: "spawn", sessionId: "s1", at: T, toolUseId: "t2", type: "Explore", description: "d", prompt: "p",
    });
  });

  it("spawn type defaults to general-purpose", () => {
    const ev = parseLine(asst([{ type: "tool_use", id: "t2", name: "Agent", input: { description: "d", prompt: "p" } }]), ctx, rules);
    expect(ev[1]).toMatchObject({ kind: "spawn", type: "general-purpose" });
  });

  it("legacy Task name also spawns", () => {
    const ev = parseLine(asst([{ type: "tool_use", id: "t3", name: "Task", input: { description: "d", prompt: "p" } }]), ctx, rules);
    expect(ev.map((e) => e.kind)).toEqual(["tool", "spawn"]);
  });

  it("usage → usage event with model, messageId and 4 token fields", () => {
    const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 };
    const ev = parseLine(asst([{ type: "text", text: "x" }], { usage }), { sessionId: "s1", agentId: "a1" }, rules);
    expect(ev).toEqual([
      { kind: "usage", sessionId: "s1", agentId: "a1", at: T, messageId: "msg_1", model: "claude-x",
        usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
    ]);
  });

  it("same message.id split across lines → usage emitted for each line", () => {
    const usage = { input_tokens: 1, output_tokens: 2 };
    const a = parseLine(asst([{ type: "text", text: "a" }], { usage }, "m9"), ctx, rules);
    const b = parseLine(asst([{ type: "tool_use", id: "t", name: "Read", input: {} }], { usage }, "m9"), ctx, rules);
    const ids = [...a, ...b].filter((e) => e.kind === "usage").map((e) => (e as { messageId: string }).messageId);
    expect(ids).toEqual(["m9", "m9"]);
  });

  it("end_turn without tools → turnEnd; with tool_use → none", () => {
    const ev = parseLine(asst([{ type: "text", text: "done" }], { stop_reason: "end_turn" }), ctx, rules);
    expect(ev).toEqual([{ kind: "turnEnd", sessionId: "s1", at: T }]);
    const t = parseLine(asst([{ type: "tool_use", id: "t", name: "Read", input: {} }], { stop_reason: "end_turn" }), ctx, rules);
    expect(t.some((e) => e.kind === "turnEnd")).toBe(false);
    const tu = parseLine(asst([{ type: "text", text: "x" }], { stop_reason: "tool_use" }), ctx, rules);
    expect(tu).toEqual([]);
  });

  it("tool_result → report with tool_use_id and text (string or text blocks joined)", () => {
    const s = line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
    expect(parseLine(s, ctx, rules)).toEqual([{ kind: "report", sessionId: "s1", at: T, toolUseId: "t1", text: "ok" }]);
    const blocks = line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [
        { type: "text", text: "a" }, { type: "image", source: {} }, { type: "text", text: "b" },
      ] }] },
    });
    expect(parseLine(blocks, ctx, rules)).toEqual([{ kind: "report", sessionId: "s1", at: T, toolUseId: "t2", text: "a\nb" }]);
  });

  it("cwd with unicode → meta.cwd kept verbatim", () => {
    const l = line({ type: "system", cwd: String.raw`D:\Học\Dự án`, gitBranch: "main" });
    expect(parseLine(l, ctx, rules)).toEqual([
      { kind: "meta", sessionId: "s1", at: T, cwd: String.raw`D:\Học\Dự án`, branch: "main" },
    ]);
  });

  it("subagent lines emit no meta", () => {
    const l = line({ type: "system", cwd: "/wt", gitBranch: "x" });
    expect(parseLine(l, { sessionId: "s1", agentId: "a1" }, rules)).toEqual([]);
  });

  it("custom-title → meta.title", () => {
    expect(parseLine(line({ type: "custom-title", customTitle: "My title" }), ctx, rules)).toEqual([
      { kind: "meta", sessionId: "s1", at: T, title: "My title" },
    ]);
    expect(parseLine(line({ type: "custom-title", title: "T2" }), ctx, rules)).toEqual([
      { kind: "meta", sessionId: "s1", at: T, title: "T2" },
    ]);
  });

  it("broken JSON → []", () => {
    expect(parseLine("{nope", ctx, rules)).toEqual([]);
    expect(parseLine("null", ctx, rules)).toEqual([]);
  });
  it("unknown type → []", () => {
    expect(parseLine(line({ type: "future-thing", x: 1 }), ctx, rules)).toEqual([]);
  });
  it("extra unknown fields ignored", () => {
    const l = line({ type: "user", zzz: { a: 1 }, message: { content: "hi", extra: [1] } });
    expect(parseLine(l, ctx, rules)).toEqual([{ kind: "prompt", sessionId: "s1", at: T }]);
  });
});

describe("parseMeta", () => {
  const c = { sessionId: "s1", agentId: "a1", at: T };
  it("reads agentType/description/toolUseId; bad JSON → null", () => {
    const j = JSON.stringify({ agentType: "Explore", description: "d", toolUseId: "t1", spawnDepth: 1 });
    expect(parseMeta(j, c)).toEqual({
      kind: "agentMeta", sessionId: "s1", agentId: "a1", toolUseId: "t1", type: "Explore", description: "d", at: T,
    });
    expect(parseMeta("{bad", c)).toBeNull();
    expect(parseMeta(JSON.stringify({ agentType: "x" }), c)).toBeNull();
  });
});
