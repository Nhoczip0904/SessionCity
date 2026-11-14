// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isChatOpen, openChat, type ChatDeps } from "../src/client/chat.js";
import { SESSION_DRAG, sessionMenu } from "../src/client/chatMenu.js";
import type { Session } from "../src/shared/types.js";

const s = (id: string, cwd: string, lastActivity: string, status: Session["status"] = "idle", title = id): Session => ({
  id, project: cwd.split("/").pop()!, cwd, title, lastActivity, status, district: "home",
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } as unknown as Session["tokens"], employees: [],
});
const SESSIONS = [
  s("a1", "/p/api", "2026-11-13T10:00:00Z", "working", "REQ"),
  s("b1", "/p/web", "2026-11-13T12:00:00Z"),
  s("a2", "/p/api", "2026-11-13T11:00:00Z", "waiting", "Issue 361"),
];

describe("sessionMenu", () => {
  it("groups sessions by folder, the most recently active group and session first", () => {
    const menu = sessionMenu(SESSIONS, "none", () => null, () => {});
    expect([...menu.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["web", "api"]);
    expect([...menu.querySelectorAll("button")].map((b) => b.dataset.id)).toEqual(["b1", "a2", "a1"]);
  });

  it("shows each session's title, status and avatar", () => {
    const menu = sessionMenu(SESSIONS, "none", (id) => (id === "a1" ? "data:img/a1" : null), () => {});
    const a1 = menu.querySelector<HTMLElement>('[data-id="a1"]')!;
    expect(a1.textContent).toContain("REQ");
    expect(a1.querySelector(".st")!.className).toContain("working");
    expect(a1.querySelector("img")!.getAttribute("src")).toBe("data:img/a1");
    expect(menu.querySelector('[data-id="b1"] img')).toBeNull();
  });

  it("marks the open session and does not reopen it on click", () => {
    const pick = vi.fn();
    const menu = sessionMenu(SESSIONS, "a2", () => null, pick);
    const cur = menu.querySelector<HTMLElement>('[data-id="a2"]')!;
    expect(cur.getAttribute("aria-current")).toBe("true");
    cur.click();
    expect(pick).not.toHaveBeenCalled();
    menu.querySelector<HTMLElement>('[data-id="a1"]')!.click();
    expect(pick).toHaveBeenCalledWith("a1");
  });

  it("falls back to the project name for a session without a title", () => {
    const menu = sessionMenu([{ ...s("x", "/p/web", "2026-11-13T00:00:00Z"), title: undefined }], "none", () => null, () => {});
    expect(menu.querySelector("button")!.textContent).toContain("web");
  });
});

class FakeWS {
  readyState = 1;
  onopen = null;
  onmessage = null;
  onclose = null;
  send() {}
  close() {}
}
const deps = { WebSocket: FakeWS as unknown as typeof WebSocket, fetch: (async () => ({ ok: false })) as unknown as typeof fetch } as ChatDeps;

describe("chat overlay menu", () => {
  afterEach(() => {
    document.querySelector<HTMLElement>(".chat-bar .close")?.click();
  });

  it("lists the sessions beside the chat and switches to the one clicked", () => {
    const pick = vi.fn();
    openChat({ sessionId: "a1", title: "api", token: "t", onClose: () => {}, menu: { sessions: () => SESSIONS, avatarOf: () => null, pick } }, deps);
    expect(isChatOpen()).toBe(true);
    const side = document.querySelector(".chat-side")!;
    expect(side.querySelector('[aria-current="true"]')!.getAttribute("data-id")).toBe("a1");
    side.querySelector<HTMLElement>('[data-id="b1"]')!.click();
    expect(pick).toHaveBeenCalledWith("b1");
  });

  it("dragging a session from the menu onto a chat box swaps it in, in that box's place", () => {
    const pick = vi.fn();
    const menu = { sessions: () => SESSIONS, avatarOf: () => null, pick };
    openChat({ sessionId: "a1", title: "api", token: "t", onClose: () => {}, menu }, deps);
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => void (store[k] = v), getData: (k: string) => store[k] ?? "", get types() { return Object.keys(store); }, effectAllowed: "", dropEffect: "" };
    const fire = (el: Element, type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: dt });
      el.dispatchEvent(e);
      return e;
    };
    const row = document.querySelector<HTMLElement>('.chat-side [data-id="b1"]')!;
    expect(row.draggable).toBe(true);
    fire(row, "dragstart");
    const box = document.querySelector<HTMLElement>(".chat-box")!;
    expect(fire(box, "dragover").defaultPrevented).toBe(true); // a drop is allowed here
    expect(box.classList.contains("dropping")).toBe(true);
    fire(box, "drop");
    expect(pick).toHaveBeenCalledWith("b1", "a1");
    expect(box.classList.contains("dropping")).toBe(false);
    pick.mockClear();
    store[SESSION_DRAG] = "<not a session>"; // an id nobody has
    fire(box, "drop");
    store[SESSION_DRAG] = "a1"; // the box's own session
    fire(box, "drop");
    expect(pick).not.toHaveBeenCalled();
  });

  it("has no menu when none is given", () => {
    openChat({ sessionId: "a1", title: "api", token: "t", onClose: () => {} }, deps);
    expect(document.querySelector(".chat-side")).toBeNull();
  });
});
