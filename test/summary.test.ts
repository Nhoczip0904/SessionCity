import { describe, expect, it } from "vitest";
import { summarize } from "../src/server/summary.js";

describe("summarize", () => {
  it.each([
    ["Bash", { command: "dotnet test" }, "dotnet test"],
    ["Read", { file_path: "src/a.cs" }, "src/a.cs"],
    ["NotebookEdit", { notebook_path: "n.ipynb" }, "n.ipynb"],
    ["Grep", { pattern: "Foo", path: "src" }, "Foo in src"],
    ["Grep", { pattern: "Foo" }, "Foo"],
    ["Glob", { pattern: "**/*.ts" }, "**/*.ts"],
    ["WebFetch", { url: "https://x" }, "https://x"],
    ["WebSearch", { query: "q" }, "q"],
    ["Agent", { subagent_type: "Explore", description: "find api" }, "Explore: find api"],
    ["Task", { description: "d" }, "general-purpose: d"],
    ["Agent", { subagent_type: "Explore" }, "Explore"],
    ["Mystery", { a: 1 }, "Mystery"],
  ])("%s → %s", (n, i, s) => expect(summarize(n, i)).toBe(s));
  it("cuts to 200 with …", () => {
    const s = summarize("Bash", { command: "x".repeat(5000) });
    expect(s.length).toBe(200);
    expect(s.endsWith("…")).toBe(true);
  });
  it("null/odd input falls back to tool name", () => {
    expect(summarize("Bash", null)).toBe("Bash");
    expect(summarize("Read", { file_path: 3 })).toBe("Read");
  });
});
