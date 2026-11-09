import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER, UserOwnedError, exploreState, setExplore } from "../src/server/agents.js";

const tmp = () => mkdtempSync(join(tmpdir(), "bc-agents-"));

describe("explore agent", () => {
  it("off when no file", () => {
    expect(exploreState(tmp())).toBe("off");
  });
  it("on -> file has frontmatter model: haiku, name: Explore and MARKER", () => {
    const d = tmp();
    expect(setExplore(d, true)).toBe("on");
    const t = readFileSync(join(d, "Explore.md"), "utf8");
    expect(t.startsWith("---\nname: Explore\n")).toBe(true);
    expect(t).toContain("\nmodel: haiku\n");
    expect(t).toContain("\ntools: Read, Grep, Glob\n");
    expect(t).toContain(MARKER);
    expect(exploreState(d)).toBe("on");
  });
  it("on then off deletes it", () => {
    const d = tmp();
    setExplore(d, true);
    expect(setExplore(d, false)).toBe("off");
    expect(existsSync(join(d, "Explore.md"))).toBe(false);
    expect(exploreState(d)).toBe("off");
  });
  it("off when already off is a no-op", () => {
    const d = tmp();
    expect(setExplore(d, false)).toBe("off");
    expect(readdirSync(d)).toEqual([]);
  });
  it("user-owned file -> state user; setExplore throws UserOwnedError; bytes unchanged", () => {
    const d = tmp();
    const bytes = Buffer.from("---\nname: Explore\n---\nmine\r\n");
    writeFileSync(join(d, "Explore.md"), bytes);
    expect(exploreState(d)).toBe("user");
    expect(() => setExplore(d, true)).toThrow(UserOwnedError);
    expect(() => setExplore(d, false)).toThrow(UserOwnedError);
    expect(readFileSync(join(d, "Explore.md")).equals(bytes)).toBe(true);
    expect(readdirSync(d)).toEqual(["Explore.md"]);
  });
  it("other files in dir untouched", () => {
    const d = tmp();
    const c = "---\nname: csharp-reviewer\n---\nreview\n";
    writeFileSync(join(d, "csharp-reviewer.md"), c);
    setExplore(d, true);
    setExplore(d, false);
    expect(readFileSync(join(d, "csharp-reviewer.md"), "utf8")).toBe(c);
  });
  it("creates the agents dir when missing", () => {
    const d = join(tmp(), "nested", "agents");
    setExplore(d, true);
    expect(exploreState(d)).toBe("on");
  });
  it("no .tmp- files left after on", () => {
    const d = tmp();
    setExplore(d, true);
    setExplore(d, true);
    expect(readdirSync(d).filter((f) => f.includes(".tmp-"))).toEqual([]);
    rmSync(d, { recursive: true });
  });
  it("marker quoted inside a sentence is user-owned, not on", () => {
    const d = tmp();
    writeFileSync(join(d, "Explore.md"), `mine, do not use ${MARKER} here\n`);
    expect(exploreState(d)).toBe("user");
  });
  it("marker on its own line (CRLF, padded) counts as on", () => {
    const d = tmp();
    writeFileSync(join(d, "Explore.md"), `x\r\n  ${MARKER}  \r\ny`);
    expect(exploreState(d)).toBe("on");
  });
  it("does not delete a colliding temp file it did not create", () => {
    const d = tmp();
    const other = join(d, "Explore.md.tmp-aaaa");
    writeFileSync(other, "not mine");
    expect(() => setExplore(d, true, () => "aaaa")).toThrow();
    expect(readFileSync(other, "utf8")).toBe("not mine");
  });
});
