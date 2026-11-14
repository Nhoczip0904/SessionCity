import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMeta } from "../src/server/sessionMeta.js";

const line = (o: object) => JSON.stringify(o);
const asst = (model: string, usage: object, content: object[] = [], extra: object = {}) => line({ type: "assistant", message: { model, usage, content }, ...extra });
const write = (file_path: string) => ({ type: "tool_use", name: "Write", input: { file_path } });

describe("readMeta", () => {
  let d: string;
  beforeAll(async () => void (d = await mkdtemp(join(tmpdir(), "meta-"))));
  afterAll(() => rm(d, { recursive: true, force: true }));

  it("takes the last reply's model and context size, and the files written, newest first, each once", async () => {
    const f = join(d, "a.jsonl");
    await writeFile(f, [
      asst("claude-opus-5-5", { input_tokens: 10, cache_read_input_tokens: 90 }, [write("C:/p/a.ts"), write("C:/p/b.ts")]),
      "not json",
      asst("claude-sonnet-5-5", { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 9 }, [write("C:/p/a.ts"), { type: "tool_use", name: "Edit", input: { file_path: "C:/p/c.ts" } }]),
      asst("claude-haiku-5-5", { input_tokens: 99999 }, [write("C:/p/side.ts")], { isSidechain: true }),
    ].join("\n"));
    expect(await readMeta(f)).toEqual({ model: "claude-sonnet-5-5", used: 1105, outputs: ["C:/p/a.ts", "C:/p/b.ts"] });
  });

  it("a missing transcript gives an empty footer", async () => {
    expect(await readMeta(join(d, "none.jsonl"))).toEqual({ model: null, used: 0, outputs: [] });
  });
});
