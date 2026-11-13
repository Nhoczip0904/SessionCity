import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { follow } from "../src/server/follow.js";

let dir: string;
let f: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "follow-"));
  f = join(dir, "s.jsonl");
  await writeFile(f, "a\n");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(ok()).toBe(true);
};

describe("follow", () => {
  it("calls back when the file grows, and stops after the returned function is called", async () => {
    let n = 0;
    const stop = follow(f, () => void n++, 30);
    await new Promise((r) => setTimeout(r, 100));
    expect(n).toBe(0); // nothing changed yet
    await appendFile(f, "b\n");
    await until(() => n >= 1);
    stop();
    const seen = n;
    await appendFile(f, "c\n");
    await new Promise((r) => setTimeout(r, 150));
    expect(n).toBe(seen);
  });

  it("does nothing for a missing file", async () => {
    let n = 0;
    const stop = follow(join(dir, "none.jsonl"), () => void n++, 30);
    await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(n).toBe(0);
  });
});
