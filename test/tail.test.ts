import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Tailer, tailStart } from "../src/server/tail.js";

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "tail-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe("Tailer", () => {
  it("returns complete lines and holds the partial one", async () => {
    const p = join(dir, "a.jsonl");
    await writeFile(p, "a\nb");
    const t = new Tailer(p);
    expect(await t.read()).toEqual(["a"]);
    await appendFile(p, "c\n");
    expect(await t.read()).toEqual(["bc"]);
  });
  it("handles CRLF", async () => {
    const p = join(dir, "b.jsonl");
    await writeFile(p, "x\r\ny\r\n");
    expect(await new Tailer(p).read()).toEqual(["x", "y"]);
  });
  it("skips the cut first line when starting mid-file", async () => {
    const p = join(dir, "c.jsonl");
    await writeFile(p, "aaa\nbbb\n");
    expect(await new Tailer(p, 2).read()).toEqual(["bbb"]);
  });
  it("restarts after truncation", async () => {
    const p = join(dir, "d.jsonl");
    await writeFile(p, "one\ntwo\n");
    const t = new Tailer(p);
    await t.read();
    await writeFile(p, "z\n");
    expect(await t.read()).toEqual(["z"]);
  });
  it("returns a multi-MB single line whole", async () => {
    const p = join(dir, "e.jsonl");
    const n = 3 * 1024 * 1024;
    await writeFile(p, "x".repeat(n) + "\n");
    const lines = await new Tailer(p).read();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(n);
  });
  it("keeps a split multi-byte char intact", async () => {
    const p = join(dir, "f.jsonl");
    const b = Buffer.from("é\n");
    await writeFile(p, b.subarray(0, 1));
    const t = new Tailer(p);
    expect(await t.read()).toEqual([]);
    await appendFile(p, b.subarray(1));
    expect(await t.read()).toEqual(["é"]);
  });
  it("missing file gives no lines", async () => {
    expect(await new Tailer(join(dir, "nope.jsonl")).read()).toEqual([]);
  });
});

it("tailStart clamps", () => {
  expect(tailStart(100)).toBe(0);
  expect(tailStart(5e6)).toBe(5e6 - 2 * 1024 * 1024);
});
