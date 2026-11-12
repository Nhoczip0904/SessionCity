import { describe, expect, it } from "vitest";
import type { Employee, Session, SessionDetail } from "../src/shared/types.js";
import { SITE_JOBS, deskSpots, siteJob, fileRows, officeLayout, roomOccupants, tokenRows } from "../src/client/rooms.js";

const z = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const sess = (o: Partial<Session>): Session => ({ id: "s", project: "p", cwd: "", lastActivity: "", status: "working", district: "lab", tokens: { ...z, byModel: {} }, employees: [], ...o });
const emp = (o: Partial<Employee>): Employee => ({ id: "e", sessionId: "s", type: "t", description: "", prompt: "", toolUseId: "", status: "working", district: "lab", startedAt: "2026-01-01", tokens: { ...z, byModel: {} }, ...o });
const detail = (o: Partial<SessionDetail>): SessionDetail => ({ ...sess({}), steps: [], staff: [], chat: [], ...o });

describe("roomOccupants", () => {
  it("orders mayors then working staff, skips done and other districts, badges", () => {
    const r = roomOccupants("lab",
      [sess({ id: "2", project: "b", status: "waiting" }), sess({ id: "1", project: "a", status: "idle" }), sess({ id: "3", district: "home" })],
      [emp({ id: "y", startedAt: "2" }), emp({ id: "x", startedAt: "1", type: "Plan" }), emp({ id: "d", status: "done" }), emp({ id: "o", district: "home" })]);
    expect(r.people.map((p) => p.id)).toEqual(["1", "2", "x", "y"]);
    expect(r.people.map((p) => p.badge)).toEqual(["z", "!", "", ""]);
    expect(r.people[2]).toMatchObject({ kind: "employee", name: "Plan" });
    expect(r.extra).toBe(0);
  });
  it("caps at 12 with extra", () => {
    const r = roomOccupants("lab", [], Array.from({ length: 15 }, (_, i) => emp({ id: String(100 + i) })));
    expect(r.people).toHaveLength(12);
    expect(r.extra).toBe(3);
  });
});

describe("deskSpots", () => {
  it("12 unique seats inside the room, off the door", () => {
    const s = deskSpots(12);
    expect(new Set(s.map((p) => `${p.x},${p.y}`)).size).toBe(12);
    for (const p of s) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThan(16);
      expect(p.x + 1).toBeLessThan(16); expect(p.y).toBeGreaterThanOrEqual(3); expect(p.y + 1).toBeLessThan(11); // chair row y, desk row y + 1, above the door row
      expect(p.x <= 8 && p.x + 1 >= 7 && p.y + 1 >= 10).toBe(false);
    }
    expect(deskSpots(3)).toHaveLength(3);
  });
  it("office: two pods of 3 desks facing 3 desks, aisle to the door in between", () => {
    const s = deskSpots(12);
    expect([...new Set(s.map((p) => p.x))].sort((a, b) => a - b)).toEqual([1, 3, 5, 9, 11, 13]);
    expect(s.filter((p) => !p.back).every((p) => p.y === 6)).toBe(true); // facing down, desk on row 7
    expect(s.filter((p) => p.back).map((p) => p.y)).toEqual([9, 9, 9, 9, 9, 9]); // facing up, desk on row 8
    expect(deskSpots(6).every((p) => !p.back)).toBe(true); // the front row fills first
  });
  it("lounge: 12 armchairs in two groups, no desk", () => {
    const s = deskSpots(12, "lounge");
    expect(s).toHaveLength(12);
    expect(s.some((p) => p.big || p.back)).toBe(false);
    expect(new Set(s.map((p) => `${p.x},${p.y}`)).size).toBe(12);
    for (const p of s) expect(p.x >= 7 && p.x <= 8).toBe(false); // the aisle to the door stays free
  });
  it("site: 12 builders scattered, not on a grid, none overlapping, clear of the tape zone and the door", () => {
    const s = deskSpots(12, "site");
    expect(s).toHaveLength(12);
    expect(s.some((p) => p.big || p.back)).toBe(false);
    expect(new Set(s.map((p) => p.y)).size).toBeGreaterThan(2); // not two neat rows
    expect(new Set(s.map((p) => p.x)).size).toBeGreaterThan(6);
    for (const p of s) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + 1).toBeLessThan(16);
      expect(p.y).toBeGreaterThanOrEqual(4); expect(p.y + 1).toBeLessThan(11); // job row above the door row
      if (p.x + 1 >= 4 && p.x <= 11) expect(p.y).toBeGreaterThanOrEqual(6); // below the taped-off zone
    }
    for (const a of s) for (const b of s) if (a !== b) expect(Math.abs(a.x - b.x) >= 3 || Math.abs(a.y - b.y) >= 2).toBe(true);
    expect(deskSpots(12, "site")).toEqual(s); // same scatter every time the room is drawn
  });
  it("site: every job is there twice", () => {
    const jobs = deskSpots(12, "site").map(siteJob);
    for (const j of SITE_JOBS) expect(jobs.filter((x) => x === j)).toHaveLength(2);
    const s = deskSpots(12, "site");
    for (const a of s) for (const b of s)
      if (a !== b && Math.abs(a.x - b.x) <= 4 && Math.abs(a.y - b.y) <= 3) expect(siteJob(a)).not.toBe(siteJob(b)); // neighbours differ
  });
  it("hall: one big desk, the rest are chairs", () => {
    const s = deskSpots(12, "hall");
    expect(s.filter((p) => p.big)).toEqual([{ x: 7, y: 3, big: true }]);
    expect(s).toHaveLength(12);
    expect(new Set(s.map((p) => `${p.x},${p.y}`)).size).toBe(12);
    for (const p of s.slice(1)) expect(p.x <= 8 && p.x >= 7 && p.y >= 10).toBe(false);
    expect(deskSpots(1, "hall")).toEqual([{ x: 7, y: 3, big: true }]);
  });
});

describe("officeLayout", () => {
  it("working first then done newest first, cap and board", () => {
    const staff = [
      emp({ id: "d1", status: "done", endedAt: "1" }), emp({ id: "d2", status: "done", endedAt: "2" }),
      emp({ id: "w2", startedAt: "2" }), emp({ id: "w1", startedAt: "1" }),
    ];
    const l = officeLayout(detail({ staff, status: "waiting", title: "T", lastPrompt: "hi" }));
    expect(l.staff.map((s) => s.id)).toEqual(["w1", "w2", "d2", "d1"]);
    expect(l.staff[2].done).toBe(true);
    expect(l.board).toEqual(["T", "Chờ bạn", "hi"]);
    const big = officeLayout(detail({ staff: Array.from({ length: 14 }, (_, i) => emp({ id: String(i) })) }));
    expect([big.staff.length, big.extra]).toEqual([12, 2]);
  });
  it("cuts prompt at 120 chars, dash when missing, project when no title", () => {
    const l = officeLayout(detail({ project: "proj", lastPrompt: "a".repeat(200) }));
    expect(l.board[2]).toBe("a".repeat(119) + "…");
    expect(l.board[0]).toBe("proj");
    expect(officeLayout(detail({ lastPrompt: "a".repeat(120) })).board[2]).toHaveLength(120);
    expect(officeLayout(detail({})).board[2]).toBe("—");
  });
});

describe("tokenRows", () => {
  it("null without tokens", () => expect(tokenRows(detail({}))).toBeNull());
  it("rows, total and staff sum", () => {
    const c = { input: 1000, output: 2, cacheRead: 3, cacheWrite: 4 };
    const r = tokenRows(detail({
      tokens: { ...c, byModel: { opus: c } },
      staff: [emp({ tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, byModel: {} } }), emp({ tokens: { ...z, input: 10, byModel: {} } })],
    }))!;
    expect(r.rows).toEqual([["opus", (1000).toLocaleString("vi-VN"), "2", "3", "4"]]);
    expect(r.total[1]).toBe((1000).toLocaleString("vi-VN"));
    expect(r.staff).toBe(20);
  });
});

describe("fileRows", () => {
  it("done staff newest first", () => {
    const r = fileRows(detail({ staff: [emp({ id: "a", status: "done", endedAt: "1" }), emp({ id: "w" }), emp({ id: "b", status: "done", endedAt: "2" })] }));
    expect(r.map((e) => e.id)).toEqual(["b", "a"]);
  });
});
