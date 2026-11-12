import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { history } from "../src/server/history.js";
import { summarize } from "../src/server/summary.js";
import { Watcher } from "../src/server/watch.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hist-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const line = (o: unknown) => JSON.stringify(o) + "\n";
const user = (content: unknown, extra = {}) => line({ type: "user", message: { role: "user", content }, ...extra });
const asst = (content: unknown[]) => line({ type: "assistant", message: { role: "assistant", content } });
const text = (t: string) => ({ type: "text", text: t });
const file = async (body: string) => {
  const f = join(dir, "s.jsonl");
  await writeFile(f, body);
  return f;
};

describe("history", () => {
  it("maps user, assistant text and tool_use", async () => {
    const f = await file(
      user("hello") + asst([text("hi there"), { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
    );
    expect(await history(f)).toEqual([
      { role: "user", text: "hello" },
      { role: "claude", text: "hi there" },
      { role: "tool", name: "Bash", summary: summarize("Bash", { command: "ls" }) },
    ]);
  });

  it("skips tool_result-only users, isMeta and command tags", async () => {
    const f = await file(
      user("<command-name>/x</command-name>") +
        user("<local-command-stdout>o</local-command-stdout>") +
        user("<system-reminder>r</system-reminder>") +
        user("meta", { isMeta: true }) +
        user("summary", { isCompactSummary: true }) +
        user([{ type: "tool_result", tool_use_id: "t1", content: "out" }]) +
        user("real"),
    );
    expect(await history(f)).toEqual([{ role: "user", text: "real" }]);
  });

  it("keeps the last 50 and cuts long text", async () => {
    let body = "";
    for (let i = 0; i < 119; i++) body += user("u" + i);
    body += asst([text("x".repeat(30000))]);
    const h = await history(await file(body));
    expect(h).toHaveLength(50);
    const last = h[49];
    expect(last.role === "claude" && last.text.length).toBe(20000);
    expect(h[48]).toEqual({ role: "user", text: "u118" });
  });

  it("survives a partial first line and junk", async () => {
    const f = await file('ial":"x"}}\n' + user("ok") + "garbage\n" + asst([text("yo")]));
    expect(await history(f)).toEqual([
      { role: "user", text: "ok" },
      { role: "claude", text: "yo" },
    ]);
  });

  it("reads only the tail of a big file", async () => {
    const pad = user("p".repeat(1000)).repeat(4500); // ~4.5 MB
    const f = await file(user("MARKER") + pad + user("recent"));
    const h = await history(f);
    expect(JSON.stringify(h)).not.toContain("MARKER");
    expect(h[h.length - 1]).toEqual({ role: "user", text: "recent" });
  });

  it("missing file -> []", async () => {
    expect(await history(join(dir, "nope.jsonl"))).toEqual([]);
  });
});

describe("Watcher.fileOf", () => {
  it("returns the main transcript", async () => {
    await mkdir(join(dir, "proj", "sid", "subagents"), { recursive: true });
    const main = join(dir, "proj", "sid.jsonl");
    await writeFile(main, user("hi"));
    await writeFile(join(dir, "proj", "sid", "subagents", "agent-x.jsonl"), user("hi"));
    const w = new Watcher(dir, () => {}, { intervalMs: 50 });
    await w.start();
    w.stop();
    expect(w.fileOf("sid")).toBe(main);
    expect(w.fileOf("nope")).toBeUndefined();
  });
});
