// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { toolBody } from "../src/client/chatTools.js";

describe("toolBody", () => {
  it("Edit shows removed lines in red and added lines in green, with the file", () => {
    const b = toolBody("Edit", { file_path: "src/a.ts", old_string: "a\nb", new_string: "c" })!;
    expect(b.querySelector(".diff-file")!.textContent).toBe("src/a.ts");
    expect([...b.querySelectorAll(".del")].map((l) => l.textContent)).toEqual(["- a", "- b"]);
    expect([...b.querySelectorAll(".add")].map((l) => l.textContent)).toEqual(["+ c"]);
  });

  it("MultiEdit shows every edit", () => {
    const b = toolBody("MultiEdit", { file_path: "f", edits: [{ old_string: "x", new_string: "y" }, { old_string: "p", new_string: "q" }] })!;
    expect(b.querySelectorAll(".del").length).toBe(2);
    expect(b.querySelectorAll(".add").length).toBe(2);
  });

  it("Write shows the content as added lines, cut when long", () => {
    const b = toolBody("Write", { file_path: "n.txt", content: Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n") })!;
    expect(b.querySelectorAll(".add").length).toBe(200);
    expect(b.textContent).toContain("300 dòng nữa");
  });

  it("Bash shows the command after a prompt", () => {
    const b = toolBody("Bash", { command: "npm test" })!;
    expect(b.className).toContain("term");
    expect(b.textContent).toBe("$ npm test");
  });

  it("TodoWrite shows a checklist with each state", () => {
    const b = toolBody("TodoWrite", { todos: [{ content: "one", status: "completed" }, { content: "two", status: "in_progress" }, { content: "three", status: "pending" }] })!;
    expect([...b.querySelectorAll("li")].map((l) => l.className)).toEqual(["completed", "in_progress", "pending"]);
    expect([...b.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["☑ one", "◐ two", "☐ three"]);
  });

  it("returns null for other tools and for input of the wrong shape", () => {
    expect(toolBody("Read", { file_path: "x" })).toBeNull();
    expect(toolBody("Edit", { file_path: 5 })).toBeNull();
    expect(toolBody("TodoWrite", { todos: "nope" })).toBeNull();
    expect(toolBody("Bash", {})).toBeNull();
  });
});
