import { describe, expect, it, vi } from "vitest";
import { openHere } from "../src/server/launch.js";

const stub = () => {
  const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
  return spawn;
};

describe("openHere", () => {
  it("file: selects the file with a quoted path and verbatim args, so spaces survive", () => {
    const spawn = stub();
    openHere("D:\\My Work\\app\\CLAUDE.md", "file", spawn as never);
    expect(spawn).toHaveBeenCalledWith("explorer.exe", ['/select,"D:\\My Work\\app\\CLAUDE.md"'], expect.objectContaining({ windowsVerbatimArguments: true }));
  });

  it("folder: plain path argument", () => {
    const spawn = stub();
    openHere("D:\\My Work", "folder", spawn as never);
    expect(spawn).toHaveBeenCalledWith("explorer.exe", ["D:\\My Work"], expect.not.objectContaining({ windowsVerbatimArguments: true }));
  });
});
