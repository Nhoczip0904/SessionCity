import { describe, expect, it } from "vitest";
import { Store } from "../src/server/store.js";
import type { Event } from "../src/shared/types.js";

const AT = "2026-11-09T10:00:00.000Z";
const MIN = 60_000;
let t = 0;
const mk = () => {
  t = 1_000_000;
  return new Store(() => t);
};
const tool = (district: any, extra: object = {}): Event =>
  ({ kind: "tool", sessionId: "s1", at: AT, name: "Read", input: {}, district, ...extra }) as Event;
const u = (n: number) => ({ input: n, output: n * 2, cacheRead: 0, cacheWrite: 1 });
const usage = (extra: object = {}): Event =>
  ({ kind: "usage", sessionId: "s1", at: AT, messageId: "m1", model: "opus", usage: u(1), ...extra }) as Event;
const spawn = (): Event =>
  ({ kind: "spawn", sessionId: "s1", at: AT, toolUseId: "tu1", type: "Explore", description: "desc", prompt: "do it" });
const agentMeta = (): Extract<Event, { kind: "agentMeta" }> =>
  ({ kind: "agentMeta", sessionId: "s1", agentId: "a1", toolUseId: "tu1", type: "Explore", description: "desc", at: AT });
const sess = (s: Store, id = "s1") => s.snapshot().sessions.find((x) => x.id === id)!;

describe("Store", () => {
  it("tool moves mayor to the classified district and marks working", () => {
    const s = mk();
    s.apply({ kind: "meta", sessionId: "s1", at: AT, cwd: ["C:", "code", "my-proj"].join(String.fromCharCode(92)) });
    s.apply({ kind: "turnEnd", sessionId: "s1", at: AT });
    s.apply(tool("library"));
    expect(sess(s)).toMatchObject({ project: "my-proj", district: "library", status: "working" });
  });

  it("project falls back to sessionId prefix without cwd", () => {
    const s = mk();
    s.apply({ kind: "prompt", sessionId: "abcdef123456", at: AT });
    expect(sess(s, "abcdef123456").project).toBe("abcdef12");
  });

  it("null district keeps the current district", () => {
    const s = mk();
    s.apply(tool("lab"));
    s.apply(tool(null));
    expect(sess(s).district).toBe("lab");
  });

  it("turnEnd → waiting at townhall", () => {
    const s = mk();
    s.apply(tool("site"));
    s.apply({ kind: "turnEnd", sessionId: "s1", at: AT });
    expect(sess(s)).toMatchObject({ status: "waiting", district: "townhall" });
  });

  it("idle after 10 minutes → home; hidden after 24 h → in removed", () => {
    const s = mk();
    s.apply(tool("site"));
    s.drainDelta();
    t += 10 * MIN - 1;
    s.tick();
    expect(sess(s).status).toBe("working");
    t += 1;
    s.tick();
    expect(sess(s)).toMatchObject({ status: "idle", district: "home" });
    expect(s.drainDelta()!.sessions.map((x) => x.id)).toEqual(["s1"]);
    t += 24 * 60 * MIN;
    s.tick();
    expect(s.snapshot().sessions).toEqual([]);
    expect(s.drainDelta()!.removed).toContain("s1");
  });

  it("two sessions in the same cwd are two sessions", () => {
    const s = mk();
    s.apply({ kind: "meta", sessionId: "s1", at: AT, cwd: "/a/p" });
    s.apply({ kind: "meta", sessionId: "s2", at: AT, cwd: "/a/p" });
    expect(s.snapshot().sessions.map((x) => x.id).sort()).toEqual(["s1", "s2"]);
  });

  it("spawn then agentMeta links prompt to employee", () => {
    const s = mk();
    s.apply(tool("library"));
    s.apply(spawn());
    expect(s.snapshot().employees).toEqual([]);
    s.apply(agentMeta());
    const [e] = s.snapshot().employees;
    expect(e).toMatchObject({
      id: "a1", sessionId: "s1", type: "Explore", description: "desc", prompt: "do it",
      toolUseId: "tu1", status: "working", district: "library",
    });
    expect(sess(s).employees).toEqual(["a1"]);
  });

  it("agentMeta then spawn links too", () => {
    const s = mk();
    s.apply(agentMeta());
    s.apply(spawn());
    expect(s.snapshot().employees[0]).toMatchObject({ id: "a1", prompt: "do it", description: "desc", type: "Explore" });
  });

  it("agent tool event moves the employee, not the mayor; unknown employee is created", () => {
    const s = mk();
    s.apply(tool("library"));
    s.apply(tool("site", { agentId: "a9" }));
    expect(sess(s).district).toBe("library");
    expect(s.snapshot().employees[0]).toMatchObject({ id: "a9", type: "unknown", district: "site", status: "working" });
    s.apply(agentMeta());
    s.apply({ ...agentMeta(), agentId: "a9" });
    expect(s.snapshot().employees.find((e) => e.id === "a9")).toMatchObject({ type: "Explore", toolUseId: "tu1" });
  });

  it("report marks the matching employee done; removed 30 s later", () => {
    const s = mk();
    s.apply(agentMeta());
    s.apply({ kind: "report", sessionId: "s1", at: AT, toolUseId: "other", text: "x" });
    expect(s.snapshot().employees[0].status).toBe("working");
    s.apply({ kind: "report", sessionId: "s1", at: AT, toolUseId: "tu1", text: "done" });
    expect(s.snapshot().employees[0]).toMatchObject({ status: "done", endedAt: AT });
    t += 30_000 - 1;
    s.tick();
    expect(s.snapshot().employees).toHaveLength(1);
    s.drainDelta();
    t += 1;
    s.tick();
    expect(s.snapshot().employees).toEqual([]);
    expect(sess(s).employees).toEqual([]);
    expect(s.drainDelta()!.removed).toContain("a1");
  });

  it("turnEnd with agentId marks that employee done; removed 30 s later", () => {
    const s = mk();
    s.apply(agentMeta());
    s.apply({ kind: "turnEnd", sessionId: "s1", at: AT, agentId: "a1" });
    expect(s.snapshot().employees[0]).toMatchObject({ status: "done", endedAt: AT });
    t += 30_000;
    s.tick();
    expect(s.snapshot().employees).toEqual([]);
  });

  it("agent tool event does not flip a waiting session back to working", () => {
    const s = mk();
    s.apply({ kind: "turnEnd", sessionId: "s1", at: AT });
    s.apply(tool("site", { agentId: "a1" }));
    expect(sess(s)).toMatchObject({ status: "waiting", district: "townhall" });
    expect(s.snapshot().employees[0].district).toBe("site");
  });

  it("id dropped by tick and re-created in the same window is not in removed", () => {
    const s = mk();
    s.apply(agentMeta());
    s.apply({ kind: "report", sessionId: "s1", at: AT, toolUseId: "tu1", text: "x" });
    s.drainDelta();
    t += 30_000;
    s.tick();
    s.apply(agentMeta());
    const d = s.drainDelta()!;
    expect(d.employees.map((e) => e.id)).toContain("a1");
    expect(d.removed).not.toContain("a1");
  });

  it("meta with unicode Windows cwd gives project from last segment", () => {
    const s = mk();
    s.apply({ kind: "meta", sessionId: "s1", at: AT, cwd: String.raw`D:\Học\Dự án` });
    expect(sess(s).project).toBe("Dự án");
  });

  it("usage sums per session, per employee and per model", () => {
    const s = mk();
    s.apply(usage({ messageId: "m1", usage: u(1) }));
    s.apply(usage({ messageId: "m2", model: "sonnet", usage: u(2) }));
    s.apply(usage({ messageId: "m3", agentId: "a1", model: "sonnet", usage: u(3) }));
    const se = sess(s);
    expect(se.model).toBe("sonnet");
    expect(se.tokens).toMatchObject({ input: 6, output: 12, cacheWrite: 3 });
    expect(se.tokens.byModel.opus.input).toBe(1);
    expect(se.tokens.byModel.sonnet.input).toBe(5);
    const e = s.snapshot().employees[0];
    expect(e.tokens).toMatchObject({ input: 3, output: 6 });
    expect(e.tokens.byModel.sonnet.input).toBe(3);
  });

  it("agent usage does not set session.model", () => {
    const s = mk();
    s.apply(usage({ agentId: "a1", model: "haiku" }));
    expect(sess(s).model).toBeUndefined();
  });

  it("same messageId twice is counted once; empty messageId counted every time", () => {
    const s = mk();
    s.apply(usage({ messageId: "m1" }));
    s.apply(usage({ messageId: "m1" }));
    expect(sess(s).tokens.input).toBe(1);
    s.apply(usage({ messageId: "" }));
    s.apply(usage({ messageId: "" }));
    expect(sess(s).tokens.input).toBe(3);
  });

  it("5 MB prompt stored as 4096 chars + …", () => {
    const s = mk();
    s.apply({ ...spawn(), prompt: "x".repeat(5 * 1024 * 1024) } as Event);
    s.apply(agentMeta());
    const p = s.snapshot().employees[0].prompt;
    expect(p).toBe("x".repeat(4096) + "…");
    s.apply({ kind: "report", sessionId: "s1", at: AT, toolUseId: "tu1", text: "y" });
  });

  it("drainDelta returns only changes, then null", () => {
    const s = mk();
    s.apply(tool("site"));
    s.apply(tool("lab", { sessionId: "s2" }));
    expect(s.drainDelta()!.sessions).toHaveLength(2);
    expect(s.drainDelta()).toBeNull();
    t += 1;
    s.apply(tool("site", { sessionId: "s2" }));
    const d = s.drainDelta()!;
    expect(d.sessions.map((x) => x.id)).toEqual(["s2"]);
    expect(d.employees).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("meta repeated with same values → drainDelta null", () => {
    const s = mk();
    const m: Event = { kind: "meta", sessionId: "s1", at: AT, cwd: "/a/p", branch: "main", title: "T" };
    s.apply(m);
    expect(s.drainDelta()).not.toBeNull();
    s.apply(m);
    expect(s.drainDelta()).toBeNull();
    s.apply({ ...m, branch: "dev" } as Event);
    expect(s.drainDelta()!.sessions[0].branch).toBe("dev");
  });

  it("replayed old events use their own time: one tick -> idle at home", () => {
    const s = mk();
    const old = new Date(t - 5 * 60 * MIN).toISOString();
    s.apply({ kind: "tool", sessionId: "s1", at: old, name: "Read", input: {}, district: "lab" });
    expect(sess(s).lastActivity).toBe(old);
    s.apply(usage({ at: old }));
    s.tick();
    expect(sess(s)).toMatchObject({ status: "idle", district: "home" });
  });

  it("replayed events older than 24 h are hidden on first tick", () => {
    const s = mk();
    const old = new Date(t - 25 * 60 * MIN).toISOString();
    s.apply({ kind: "tool", sessionId: "s1", at: old, name: "Read", input: {}, district: "lab" });
    s.tick();
    expect(s.snapshot().sessions).toEqual([]);
  });

  it("hiding a session clears its seen messageIds and pending spawns", () => {
    const s = mk();
    s.apply(usage({ messageId: "m1" }));
    s.apply(spawn());
    t += 24 * 60 * MIN;
    s.tick();
    expect(s.snapshot().sessions).toEqual([]);
    s.apply(usage({ messageId: "m1" }));
    expect(sess(s).tokens.input).toBe(1);
    s.apply(agentMeta());
    expect(s.snapshot().employees[0].prompt).toBe("");
  });

  it("session going idle finishes its working employees; removed 30 s later", () => {
    const s = mk();
    s.apply(agentMeta());
    t += 10 * MIN;
    s.tick();
    expect(s.snapshot().employees[0].status).toBe("done");
    expect(s.snapshot().employees[0].endedAt).toBeDefined();
    t += 30_000;
    s.tick();
    expect(s.snapshot().employees).toEqual([]);
  });

  it("real replay order meta -> usage -> tool, hours old: idle at home after one tick", () => {
    const s = mk();
    const old = new Date(t - 5 * 60 * MIN).toISOString();
    s.apply({ kind: "meta", sessionId: "s1", at: old, cwd: "/a/p" });
    s.apply(usage({ at: old }));
    s.apply({ kind: "tool", sessionId: "s1", at: old, name: "Read", input: {}, district: "lab" });
    s.tick();
    expect(sess(s)).toMatchObject({ status: "idle", district: "home", lastActivity: old });
  });

  it("real replay order, >24 h old: hidden and in removed", () => {
    const s = mk();
    const old = new Date(t - 25 * 60 * MIN).toISOString();
    s.apply({ kind: "meta", sessionId: "s1", at: old, cwd: "/a/p" });
    s.apply(usage({ at: old }));
    s.apply({ kind: "tool", sessionId: "s1", at: old, name: "Read", input: {}, district: "lab" });
    s.tick();
    expect(s.snapshot().sessions).toEqual([]);
    expect(s.drainDelta()!.removed).toContain("s1");
  });

  it("meta and usage alone do not mark a session working", () => {
    const s = mk();
    s.apply({ kind: "turnEnd", sessionId: "s1", at: AT });
    s.apply({ kind: "meta", sessionId: "s1", at: AT, cwd: "/a/p" });
    s.apply(usage());
    expect(sess(s).status).toBe("waiting");
  });
});
