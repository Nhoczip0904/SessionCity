// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { Alerts, withAsks } from "../src/client/alerts.js";
import { fillAsks, type AskCtx } from "../src/client/asks.js";
import { AgentList } from "../src/client/agentList.js";
import type { AskRow, Session } from "../src/shared/types.js";

const sess = (id: string, status: Session["status"], project = id): Session =>
  ({ id, project, cwd: "", lastActivity: "2026-01-01T00:00:00Z", status, district: "lab", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byModel: {} }, employees: [] }) as Session;
const ask = (session: string, id = "r1"): AskRow => ({ session, id, tool: "Bash", summary: "npm test" });

describe("withAsks", () => {
  it("shows a session with an open question as waiting, leaves the rest alone", () => {
    const out = withAsks([sess("a", "working"), sess("b", "idle"), sess("c", "waiting")], [ask("a")]);
    expect(out.map((s) => s.status)).toEqual(["waiting", "idle", "waiting"]);
  });
  it("does not change the input", () => {
    const s = [sess("a", "working")];
    withAsks(s, [ask("a")]);
    expect(s[0]!.status).toBe("working");
  });
});

describe("Alerts", () => {
  const make = (away: boolean) => {
    const env = { away: () => away, notify: vi.fn(), title: vi.fn() };
    return { env, alerts: new Alerts(env, "SessionCity") };
  };
  it("sessions already waiting at load are not announced, but the title counts them", () => {
    const { env, alerts } = make(true);
    alerts.update([sess("a", "waiting")], [], () => {});
    expect(env.notify).not.toHaveBeenCalled();
    expect(env.title).toHaveBeenLastCalledWith("(1) ! Chờ bạn · SessionCity");
  });
  it("announces a session that starts waiting, once, while the user is away", () => {
    const { env, alerts } = make(true);
    alerts.update([sess("a", "working", "proj")], [], () => {});
    alerts.update([sess("a", "waiting", "proj")], [], () => {});
    alerts.update([sess("a", "waiting", "proj")], [], () => {});
    expect(env.notify).toHaveBeenCalledTimes(1);
    expect(env.notify.mock.calls[0]![0]).toBe("proj cần bạn");
    alerts.update([sess("a", "working", "proj")], [], () => {});
    expect(env.title).toHaveBeenLastCalledWith("SessionCity");
  });
  it("says what a permission question is about, and clicking it hands back the session", () => {
    const { env, alerts } = make(true);
    const click = vi.fn();
    alerts.update([sess("a", "working")], [], click);
    alerts.update([sess("a", "waiting")], [ask("a")], click);
    const [, body, onClick] = env.notify.mock.calls[0]!;
    expect(body).toBe("Xin quyền Bash: npm test");
    onClick();
    expect(click).toHaveBeenCalledWith("a");
  });
  it("stays quiet while the user is looking at the page, but the title still changes", () => {
    const { env, alerts } = make(false);
    alerts.update([sess("a", "working")], [], () => {});
    alerts.update([sess("a", "waiting")], [], () => {});
    expect(env.notify).not.toHaveBeenCalled();
    expect(env.title).toHaveBeenLastCalledWith("(1) ! Chờ bạn · SessionCity");
  });
});

describe("fillAsks", () => {
  const ctx = (answer: AskCtx["answer"] = async () => null): AskCtx => ({ label: (s) => `name-${s}`, avatarOf: (s) => (s === "a" ? "data:image/png;base64,AA" : null), answer, open: vi.fn() });
  it("one card per question with the session, tool and command; the face when there is one", () => {
    const body = document.createElement("div");
    fillAsks(body, [ask("a"), ask("b", "r2")], ctx());
    const cards = body.querySelectorAll(".ask");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain("name-a");
    expect(cards[0]!.textContent).toContain("Bash");
    expect(cards[0]!.querySelector("pre")!.textContent).toBe("npm test");
    expect(cards[0]!.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,AA");
    expect(cards[1]!.querySelector("img")).toBeNull();
  });
  it("Allow and Deny send the question with the choice", async () => {
    const answer = vi.fn(async () => null);
    const body = document.createElement("div");
    fillAsks(body, [ask("a")], ctx(answer));
    const [yes, no] = [...body.querySelectorAll("button")] as HTMLButtonElement[];
    yes!.click();
    await Promise.resolve();
    expect(answer).toHaveBeenCalledWith(ask("a"), true);
    expect(yes!.disabled && no!.disabled).toBe(true); // no double answer while it is in flight
    fillAsks(body, [ask("a")], ctx(answer));
    body.querySelectorAll("button")[1]!.click();
    expect(answer).toHaveBeenLastCalledWith(ask("a"), false);
  });
  it("a failed answer shows the message and lets the user try again", async () => {
    const body = document.createElement("div");
    fillAsks(body, [ask("a")], ctx(async () => "Câu hỏi này không còn nữa"));
    const yes = body.querySelector<HTMLButtonElement>("button")!;
    yes.click();
    await new Promise((r) => setTimeout(r));
    expect(body.querySelector(".ask-err")!.textContent).toBe("Câu hỏi này không còn nữa");
    expect(yes.disabled).toBe(false);
  });
  it("Xem phiên opens the session; an empty list says so; names stay text", () => {
    const c = ctx();
    const body = document.createElement("div");
    fillAsks(body, [ask("a")], c);
    body.querySelectorAll("button")[2]!.click();
    expect(c.open).toHaveBeenCalledWith("a");
    fillAsks(body, [], c);
    expect(body.textContent).toContain("Không còn câu hỏi");
    fillAsks(body, [{ ...ask("a"), summary: "<img src=x>" }], c);
    expect(body.querySelector("pre img")).toBeNull();
  });
});

describe("agent list alert square", () => {
  it("a waiting session gets the square, the others do not", () => {
    const root = document.createElement("div");
    new AgentList(root, () => {}).render([sess("a", "waiting"), sess("b", "working")], []);
    const rows = [...root.querySelectorAll<HTMLElement>(".agent-row")];
    expect(rows.map((r) => !!r.querySelector(".alert"))).toEqual([false, true]); // working sorts first
  });
});

describe("renderWaiting", () => {
  it("shows what Claude said as text, with a way to chat and a way to see the session", async () => {
    const { renderWaiting } = await import("../src/client/asks.js");
    const go = { chat: vi.fn(), open: vi.fn() };
    const el = renderWaiting("Bạn chọn <b>A</b> hay B?", go);
    expect(el.querySelector("pre")!.textContent).toBe("Bạn chọn <b>A</b> hay B?");
    expect(el.querySelector("b")).toBeNull();
    const [reply, more] = [...el.querySelectorAll("button")];
    reply!.click();
    more!.click();
    expect(go.chat).toHaveBeenCalledTimes(1);
    expect(go.open).toHaveBeenCalledTimes(1);
    expect(renderWaiting("", go).textContent).toContain("chưa đọc được");
  });
});
