import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, loadRules } from "../src/server/classify.js";

const rules = loadRules(JSON.parse(readFileSync("config/districts.json", "utf8")));

describe("classify", () => {
  it.each([
    ["Read", { file_path: "src/a.cs" }, "library"],
    ["Grep", { pattern: "x" }, "library"],
    ["TodoWrite", {}, "design"],
    ["Write", { file_path: "docs/superpowers/specs/x.md" }, "design"],
    ["Edit", { file_path: "src/Api/Program.cs" }, "site"],
    ["Edit", { file_path: "src/Infra/Migrations/2026_Init.cs" }, "database"],
    ["Bash", { command: "dotnet ef database update" }, "database"],
    ["Bash", { command: "dotnet test --no-build" }, "lab"],
    ["Bash", { command: "npm run test" }, "lab"],
    ["Bash", { command: "dotnet build -c Release" }, "factory"],
    ["Bash", { command: "git push origin main" }, "airport"],
    ["Bash", { command: "git commit -m x" }, "review"],
    ["Bash", { command: "gh pr view 3" }, "review"],
    ["Bash", { command: "docker logs api" }, "watchtower"],
  ])("%s %j → %s", (tool, input, d) => expect(classify(rules, tool, input)).toBe(d));
  it("unmatched bash keeps district", () => expect(classify(rules, "Bash", { command: "ls -la" })).toBeNull());
  it("unknown tool keeps district", () => expect(classify(rules, "Agent", { prompt: "x" })).toBeNull());
  it("rejects unknown district", () => expect(() => loadRules([{ district: "moon", tool: "Read" }])).toThrow(/rule 1/));
  it("rejects bad regex", () => expect(() => loadRules([{ district: "lab", command: "(" }])).toThrow(/rule 1/));
});
