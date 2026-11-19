import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { drawDeskJob } from "../src/client/deskJobs.js";
import { ROOM_THEMES, deskJob, deskSpots, type DeskJob } from "../src/client/rooms.js";

const ALL: DeskJob[] = ["read", "candle", "quill", "draft", "roll", "lens", "laptop", "chart", "pour", "drip", "console"];
const shot = (job: DeskJob, t: number, on: boolean) => {
  const g = new Graphics();
  drawDeskJob(g, job, 0, 0, t, on, 3);
  const seen = new WeakSet<object>();
  return JSON.stringify(g.context.instructions, (k, v) => (k === "uid" ? undefined : v && typeof v === "object" ? (seen.has(v) ? undefined : (seen.add(v), v)) : v));
};

describe("desk jobs", () => {
  it("every job draws something, and moves while working", () => {
    for (const j of ALL) {
      expect(shot(j, 0, true).length, j).toBeGreaterThan(20);
      const frames = new Set([0, 150, 300, 450, 600, 777, 1000, 1300].map((t) => shot(j, t, true)));
      expect(frames.size, `${j} animates`).toBeGreaterThan(1);
    }
  });
  it("a job at rest is still, whatever the clock says", () => {
    for (const j of ALL) expect(shot(j, 0, false)).toBe(shot(j, 777, false));
  });
  it("rooms give their own jobs: reading, drafting, computing, pouring, console", () => {
    expect(ROOM_THEMES.library!.deskJobs).toEqual(["read", "candle", "quill"]);
    expect(ROOM_THEMES.design!.deskJobs).toEqual(["draft", "roll", "lens"]);
    expect(ROOM_THEMES.database!.deskJobs).toEqual(["laptop", "chart"]);
    expect(ROOM_THEMES.lab!.deskJobs).toEqual(["pour", "drip"]);
    expect(ROOM_THEMES.watchtower!.deskJobs).toEqual(["console"]);
    expect(ROOM_THEMES.watchtower!.layout).toBe("console");
  });
  it("neighbouring desks (same row, next pod, desk across) do different jobs; the choice never changes", () => {
    for (const jobs of [ROOM_THEMES.library!.deskJobs!, ROOM_THEMES.design!.deskJobs!, ROOM_THEMES.database!.deskJobs!, ROOM_THEMES.lab!.deskJobs!]) {
      const s = deskSpots(12);
      const of = (p: { x: number; y: number }) => deskJob(jobs, p);
      for (const a of s) expect(jobs).toContain(of(a));
      for (const a of s) for (const b of s) if (a.y === b.y && b.x - a.x === 2) expect(of(a), `${a.x},${a.y}`).not.toBe(of(b));
      expect(s.map(of)).toEqual(deskSpots(12).map(of));
    }
  });
  it("no jobs, no job; console seats are two rows of backs", () => {
    expect(deskJob(undefined, { x: 1, y: 6 })).toBeNull();
    const s = deskSpots(12, "console");
    expect(s).toHaveLength(12);
    expect(s.every((p) => p.back)).toBe(true);
    expect(new Set(s.map((p) => p.y)).size).toBe(2);
    for (const p of s) expect(p.x === 7 || p.x === 8).toBe(false); // the aisle stays free
  });
});
