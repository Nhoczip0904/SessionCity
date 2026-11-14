import { describe, expect, it } from "vitest";
import { Finishes, readDone, writeDone } from "../src/client/party.js";

const s = (id: string, status: "working" | "waiting" | "idle") => ({ id, status });

describe("Finishes", () => {
  it("the first look is not news, even for idle sessions", () => {
    expect(new Finishes().update([s("a", "idle"), s("b", "working")])).toEqual([]);
  });
  it("working → idle fires once", () => {
    const f = new Finishes();
    f.update([s("a", "working")]);
    expect(f.update([s("a", "idle")])).toEqual(["a"]);
    expect(f.update([s("a", "idle")])).toEqual([]);
  });
  it("idle → idle, idle → working and a session first seen idle do not fire", () => {
    const f = new Finishes();
    f.update([s("a", "idle")]);
    expect(f.update([s("a", "idle"), s("b", "idle")])).toEqual([]);
    expect(f.update([s("a", "working"), s("b", "idle")])).toEqual([]);
  });
  it("working → waiting is not a finish; working → waiting → idle is", () => {
    const f = new Finishes();
    f.update([s("a", "working")]);
    expect(f.update([s("a", "waiting")])).toEqual([]);
    expect(f.update([s("a", "idle")])).toEqual(["a"]);
  });
  it("a session that was idle and then waits does not fire when it goes idle again", () => {
    const f = new Finishes();
    f.update([s("a", "idle")]);
    f.update([s("a", "waiting")]);
    expect(f.update([s("a", "idle")])).toEqual([]);
  });
});

describe("the day's count", () => {
  it("reads today's number, and zero for another day, nothing or garbage", () => {
    expect(readDone("2026-11-14:3", "2026-11-14")).toBe(3);
    expect(readDone("2026-11-13:3", "2026-11-14")).toBe(0);
    expect(readDone(null, "2026-11-14")).toBe(0);
    expect(readDone("lol", "2026-11-14")).toBe(0);
  });
  it("writes what it reads", () => {
    expect(readDone(writeDone("2026-11-14", 5), "2026-11-14")).toBe(5);
  });
});
