// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { Scene, type Place, type SceneDeps } from "../src/client/scene.js";
import { Panel } from "../src/client/panel.js";
import type { Delta, SessionDetail } from "../src/shared/types.js";

const detail = (id: string) => ({ id }) as unknown as SessionDetail;
const delta = (o: Partial<Delta> = {}): Delta => ({ sessions: [], employees: [], removed: [], ...o });
const office = (id: string): Place => ({ kind: "office", sessionId: id });
const flush = () => vi.advanceTimersByTimeAsync(0);

let scenes: Scene[] = [];
function make(f: SceneDeps["fetchSession"] = async (id) => detail(id)) {
  const mount = new Container();
  const fetchSession = vi.fn(f);
  const draw = vi.fn((_p: unknown, _d: unknown, _e: boolean) => new Container());
  const onChange = vi.fn();
  const scene = new Scene({ mount, draw, fetchSession, onChange });
  scenes.push(scene);
  return { scene, mount, draw, onChange, fetchSession };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  scenes.forEach((s) => s.dispose());
  scenes = [];
  vi.useRealTimers();
});

describe("Scene", () => {
  it("enter room draws once, exit destroys it", () => {
    const { scene, mount, draw, onChange } = make();
    scene.enter({ kind: "room", district: "library" });
    expect(draw).toHaveBeenCalledTimes(1);
    const room = mount.children[0] as Container;
    scene.exit();
    expect(room.destroyed).toBe(true);
    expect(mount.children.length).toBe(0);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "city" });
  });
  it("20 enter/exit cycles leave one or zero children", () => {
    const { scene, mount } = make();
    for (let i = 0; i < 20; i++) {
      scene.enter({ kind: "room", district: "library" });
      scene.exit();
    }
    scene.enter({ kind: "room", district: "site" });
    expect(mount.children.length).toBeLessThanOrEqual(1);
    scene.exit();
    expect(mount.children.length).toBe(0);
  });
  it("office: stale fetch after exit is ignored", async () => {
    let res!: (d: SessionDetail) => void;
    const { scene, mount, draw } = make(() => new Promise((r) => (res = r)));
    scene.enter(office("a"));
    scene.exit();
    res(detail("a"));
    await flush();
    expect(scene.place.kind).toBe("city");
    expect(mount.children.length).toBe(0);
    expect(draw).toHaveBeenCalledTimes(1);
  });
  it("switching office ignores the first fetch", async () => {
    const res: Record<string, (d: SessionDetail) => void> = {};
    const { scene, draw } = make((id) => new Promise((r) => (res[id] = r)));
    scene.enter(office("a"));
    scene.enter(office("b"));
    res.b(detail("b"));
    await flush();
    res.a(detail("a"));
    await flush();
    expect(draw).toHaveBeenLastCalledWith(office("b"), detail("b"), false);
    expect(draw.mock.calls.some((c) => (c[1] as SessionDetail | null)?.id === "a")).toBe(false);
  });
  it("office: gone -> back to city", async () => {
    const { scene } = make(async () => "gone");
    scene.enter(office("a"));
    await flush();
    expect(scene.place).toEqual({ kind: "city" });
  });
  it("removed session in delta -> back to city", async () => {
    const { scene } = make();
    scene.enter(office("a"));
    await flush();
    scene.onDelta(delta({ removed: ["a"] }));
    expect(scene.place).toEqual({ kind: "city" });
  });
  it("delta for another session does not refetch", async () => {
    const { scene, fetchSession } = make();
    scene.enter(office("a"));
    await flush();
    scene.onDelta(delta({ sessions: [{ id: "b" } as never], employees: [{ id: "e", sessionId: "b" } as never] }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });
  it("bursts of deltas refetch at most once per second", async () => {
    const { scene, fetchSession } = make();
    scene.enter(office("a"));
    await flush();
    for (let i = 0; i < 10; i++) scene.onDelta(delta({ sessions: [{ id: "a" } as never] }));
    scene.onDelta(delta({ employees: [{ id: "e", sessionId: "a" } as never] }));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });
  it("network error retries after 3 s", async () => {
    let n = 0;
    const { scene, draw, fetchSession } = make(async (id) => {
      if (n++ === 0) throw new Error("net");
      return detail(id);
    });
    scene.enter(office("a"));
    await flush();
    expect(draw).toHaveBeenLastCalledWith(office("a"), null, true);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenLastCalledWith(office("a"), detail("a"), false);
  });
  it("Esc closes the panel first, then the room", async () => {
    const root = document.createElement("div");
    const panel = new Panel(root, vi.fn().mockResolvedValue("gone"));
    const { scene } = make();
    scene.enter({ kind: "room", district: "library" });
    await panel.open("session", "s1");
    const esc = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    esc();
    expect(root.hidden).toBe(true);
    expect(scene.place.kind).toBe("room");
    esc();
    expect(scene.place.kind).toBe("city");
  });
});
