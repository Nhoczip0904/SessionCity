import { describe, expect, it, vi } from "vitest";

// wt.exe is an app execution alias: existsSync is false for it but accessSync succeeds.
vi.mock("node:fs", async (orig) => ({ ...(await orig<typeof import("node:fs")>()), existsSync: () => false }));

describe("findOnPath default exists", () => {
  it("uses access semantics, not existsSync", async () => {
    const { findOnPath } = await import("../src/server/launch.js");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "bc-path-"));
    writeFileSync(join(dir, "wt.exe"), "");
    expect(findOnPath("wt", [], { PATH: dir } as NodeJS.ProcessEnv, undefined, [".exe"])).toBe(join(dir, "wt.exe"));
  });
});
