// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isChatOpen, openChat, type ChatDeps } from "../src/client/chat.js";
import { NOTE_DRAG } from "../src/shared/notes.js";
import { SESSION_DRAG, refreshMenus, sessionMenu, setPrLoader } from "../src/client/chatMenu.js";
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

  it("refreshMenus redraws a menu that is on the page with the new sessions, and forgets one that is gone", () => {
    const menu = sessionMenu(SESSIONS, "a2", () => null, () => {});
    document.body.append(menu);
    refreshMenus([{ ...SESSIONS[0]!, status: "waiting", title: "renamed" }, s("c1", "/p/new", "2026-11-14T00:00:00Z")]);
    expect([...menu.querySelectorAll("button")].map((b) => b.dataset.id)).toEqual(["c1", "a1"]);
    expect(menu.querySelector('[data-id="a1"] .st')!.className).toContain("waiting");
    expect(menu.querySelector('[data-id="a1"]')!.textContent).toContain("renamed");
    menu.remove();
    refreshMenus([]);
    expect(menu.querySelectorAll("button")).toHaveLength(2); // detached: left alone
  });

  it("a session that opened PRs shows a count badge; clicking it lists them, state and diff size, without picking the session", async () => {
    const pick = vi.fn();
    const load = vi.fn(async () => [
      { url: "https://github.com/o/r/pull/7", repo: "o/r", number: 7, title: "Fix <b>x</b>", state: "merged" as const, additions: 12, deletions: 3 },
      { url: "https://github.com/o/r/pull/8", repo: "o/r", number: 8, title: "", state: null, additions: 0, deletions: 0 },
    ]);
    setPrLoader(load);
    const withPrs = { ...SESSIONS[1]!, prs: ["https://github.com/o/r/pull/7", "https://github.com/o/r/pull/8"] };
    const menu = sessionMenu([withPrs, SESSIONS[0]!], "none", () => null, pick);
    document.body.append(menu);
    expect(menu.querySelector('[data-id="a1"] .prs')).toBeNull();
    const badge = menu.querySelector<HTMLElement>('[data-id="b1"] .prs')!;
    expect(badge.textContent).toContain("2");
    badge.click();
    await vi.waitFor(() => expect(document.querySelector(".pr-pop")).not.toBeNull());
    const pop = document.querySelector<HTMLElement>(".pr-pop")!;
    expect(load).toHaveBeenCalledWith("b1");
    expect(pick).not.toHaveBeenCalled();
    expect(pop.querySelector("b")).toBeNull(); // title is text, not markup
    expect(pop.textContent).toContain("Fix <b>x</b>");
    expect(pop.textContent).toContain("Đã hợp nhất");
    expect(pop.textContent).toContain("o/r #7");
    expect(pop.textContent).toContain("+12");
    expect(pop.textContent).toContain("−3");
    const a = pop.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://github.com/o/r/pull/7");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    badge.click(); // second click closes
    expect(document.querySelector(".pr-pop")).toBeNull();
    menu.remove();
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

describe("hiding sessions", () => {
  afterEach(() => localStorage.clear());
  const ids = (m: HTMLElement) => [...m.querySelectorAll<HTMLElement>(".chat-pick")].map((b) => b.dataset.id);

  it("the x on a row hides that session without opening it, and it stays hidden in a new menu", () => {
    const pick = vi.fn();
    const menu = sessionMenu(SESSIONS, "none", () => null, pick);
    menu.querySelector<HTMLElement>('[data-id="a2"] .hide')!.click();
    expect(pick).not.toHaveBeenCalled();
    expect(ids(menu)).toEqual(["b1", "a1"]);
    expect(ids(sessionMenu(SESSIONS, "none", () => null, () => {}))).toEqual(["b1", "a1"]);
  });

  it("a folder whose sessions are all hidden loses its heading", () => {
    const menu = sessionMenu(SESSIONS, "none", () => null, () => {});
    menu.querySelector<HTMLElement>('[data-id="b1"] .hide')!.click();
    expect([...menu.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["api"]);
  });

  it("the open session cannot be hidden", () => {
    const menu = sessionMenu(SESSIONS, "a1", () => null, () => {});
    expect(menu.querySelector('[data-id="a1"] .hide')).toBeNull();
  });

  it("a toggle at the bottom shows the hidden ones again, and the x then brings one back", () => {
    const menu = sessionMenu(SESSIONS, "none", () => null, () => {});
    menu.querySelector<HTMLElement>('[data-id="a2"] .hide')!.click();
    const toggle = menu.querySelector<HTMLElement>(".show-hidden")!;
    expect(toggle.textContent).toContain("1");
    toggle.click();
    expect(ids(menu)).toEqual(["b1", "a2", "a1"]);
    menu.querySelector<HTMLElement>('[data-id="a2"] .hide')!.click(); // now unhides
    expect(ids(menu)).toEqual(["b1", "a2", "a1"]);
    expect(menu.querySelector(".show-hidden")).toBeNull(); // nothing hidden: no toggle
    menu.querySelector<HTMLElement>('[data-id="a1"] .hide')!.click(); // a later hide starts collapsed again
    expect(ids(menu)).toEqual(["b1", "a2"]);
  });

  it("a broken stored list is ignored", () => {
    localStorage.setItem("city.hiddenSessions", "{not json");
    expect(ids(sessionMenu(SESSIONS, "none", () => null, () => {}))).toEqual(["b1", "a2", "a1"]);
  });
});

describe("chat overlay menu", () => {
  afterEach(() => {
    document.querySelector<HTMLElement>(".chat-bar .close")?.click();
  });

  it("lists the sessions beside the chat and switches to the one clicked", () => {
    const pick = vi.fn();
    openChat({ sessionId: "a1", title: "api", onClose: () => {}, menu: { sessions: () => SESSIONS, avatarOf: () => null, pick } }, deps);
    expect(isChatOpen()).toBe(true);
    const side = document.querySelector(".chat-side")!;
    expect(side.querySelector('[aria-current="true"]')!.getAttribute("data-id")).toBe("a1");
    side.querySelector<HTMLElement>('[data-id="b1"]')!.click();
    expect(pick).toHaveBeenCalledWith("b1");
  });

  it("dragging a session from the menu onto a chat box swaps it in, in that box's place", () => {
    const pick = vi.fn();
    const menu = { sessions: () => SESSIONS, avatarOf: () => null, pick };
    openChat({ sessionId: "a1", title: "api", onClose: () => {}, menu }, deps);
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

  it("a note dragged from the city drops its text into the input, wherever on the box it lands", () => {
    openChat({ sessionId: "a1", title: "api", onClose: () => {} }, deps);
    const store: Record<string, string> = { [NOTE_DRAG]: "1", "text/plain": "user / pw" };
    const dt = { getData: (k: string) => store[k] ?? "", get types() { return Object.keys(store); }, dropEffect: "" };
    const fire = (el: Element, type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: dt });
      el.dispatchEvent(e);
      return e;
    };
    const box = document.querySelector<HTMLElement>(".chat-box")!;
    const input = box.querySelector("textarea")!;
    input.value = "login:";
    expect(fire(box, "dragover").defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe("copy");
    expect(fire(box.querySelector(".chat-log")!, "drop").defaultPrevented).toBe(true); // we insert it, not the browser
    expect(input.value).toBe("login: user / pw");
  });

  it("rows of the sessions with an open chat get data-open, and lose it when the chat closes", () => {
    const menu = { sessions: () => SESSIONS, avatarOf: () => null, pick: vi.fn() };
    openChat({ sessionId: "a1", title: "api", onClose: () => {}, menu }, deps);
    const rows = () => [...document.querySelectorAll<HTMLElement>(".chat-side [data-id]")].filter((r) => r.dataset.open).map((r) => r.dataset.id);
    expect(rows()).toEqual(["a1"]);
    openChat({ sessionId: "b1", title: "web", onClose: () => {}, menu }, deps);
    expect(rows().sort()).toEqual(["a1", "b1"]);
    document.querySelector<HTMLElement>(".chat-bar .close")?.click();
    expect(rows()).toHaveLength(1);
    document.querySelectorAll<HTMLElement>(".chat-bar .close").forEach((c) => c.click());
    expect(rows()).toEqual([]);
  });

  it("has no menu when none is given", () => {
    openChat({ sessionId: "a1", title: "api", onClose: () => {} }, deps);
    expect(document.querySelector(".chat-side")).toBeNull();
  });
});
