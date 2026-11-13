// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { openChat, type ChatDeps } from "../src/client/chat.js";

class FakeWS {
  static last: FakeWS;
  sent: string[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWS.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {}
}
const deps = { WebSocket: FakeWS as unknown as typeof WebSocket } as ChatDeps;

function setup() {
  openChat({ sessionId: "abc", title: "proj", token: "t", onClose: () => {} }, deps);
  const ws = FakeWS.last;
  ws.onopen?.();
  const frame = (m: object) => ws.onmessage!({ data: JSON.stringify(m) });
  return { ws, frame, ev: (e: object) => frame({ t: "ev", e }) };
}
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const input = () => $<HTMLTextAreaElement>(".chat-input textarea");
const key = (k: string, init: KeyboardEventInit = {}) => input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const say = (t: string) => {
  input().value = t;
  key("Enter");
};
const delta = (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, parent_tool_use_id: null });
const result = () => ({ type: "result", subtype: "success", is_error: false, duration_ms: 1000 });

afterEach(() => {
  document.querySelector<HTMLElement>(".chat-overlay .close")?.click();
  document.body.innerHTML = "";
});

describe("working indicator", () => {
  it("shows while Claude works, stays last in the log, and goes when the turn ends", () => {
    const { ev } = setup();
    expect(document.querySelector(".think")).toBeNull();
    say("hi");
    expect($(".think").textContent).toContain("Claude đang làm");
    ev(delta("Hel"));
    expect($(".chat-log").lastElementChild!.className).toContain("think");
    ev(result());
    expect(document.querySelector(".think")).toBeNull();
  });

  it("a blinking cursor marks the message being written, until the turn ends", () => {
    const { ev } = setup();
    say("hi");
    ev(delta("Hel"));
    expect(document.querySelectorAll(".msg.claude.typing").length).toBe(1);
    ev(result());
    expect(document.querySelector(".typing")).toBeNull();
  });

  it("goes when the connection drops", () => {
    const { ws } = setup();
    say("hi");
    ws.onclose!({ code: 4000, reason: "1" });
    expect(document.querySelector(".think")).toBeNull();
  });
});

describe("input box", () => {
  it("grows with its text and shrinks back after sending", () => {
    setup();
    Object.defineProperty(input(), "scrollHeight", { configurable: true, get: () => 90 });
    input().value = "a\nb\nc";
    input().dispatchEvent(new Event("input"));
    expect(input().style.height).toBe("90px");
    Object.defineProperty(input(), "scrollHeight", { configurable: true, get: () => 5000 });
    input().dispatchEvent(new Event("input"));
    expect(input().style.height).toBe("200px");
    say("send");
    expect(input().style.height).toBe("auto");
  });

  it("Shift+Enter does not send", () => {
    const { ws } = setup();
    input().value = "x";
    key("Enter", { shiftKey: true });
    expect(ws.sent).toEqual([]);
  });

  it("arrow up in an empty box brings back the last messages, arrow down goes forward", () => {
    const { ev } = setup();
    say("first");
    ev(result());
    say("second");
    ev(result());
    key("ArrowUp");
    expect(input().value).toBe("second");
    input().value = "second";
    input().setSelectionRange(0, 0);
    key("ArrowUp");
    expect(input().value).toBe("first");
    input().setSelectionRange(5, 5);
    key("ArrowDown");
    expect(input().value).toBe("second");
    key("ArrowDown");
    expect(input().value).toBe("");
  });

  it("arrow up leaves text being typed alone", () => {
    setup();
    say("old");
    input().value = "typing something";
    input().setSelectionRange(6, 6);
    key("ArrowUp");
    expect(input().value).toBe("typing something");
  });

  it("recalls messages from the loaded history too", () => {
    const { frame } = setup();
    frame({ t: "history", items: [{ role: "user", text: "from before" }, { role: "claude", text: "ok" }] });
    key("ArrowUp");
    expect(input().value).toBe("from before");
  });
});

describe("tool rows", () => {
  const use = (id: string, name: string, inp: object) => ({ type: "assistant", message: { id: "m", role: "assistant", content: [{ type: "tool_use", id, name, input: inp }] }, parent_tool_use_id: null });

  it("an Edit shows a diff, not raw JSON", () => {
    const { ev } = setup();
    ev(use("t1", "Edit", { file_path: "a.ts", old_string: "x", new_string: "y" }));
    expect($(".tool .del").textContent).toBe("- x");
    expect($(".tool").textContent).not.toContain("old_string");
  });

  it("the todo list opens by itself; other tools stay closed", () => {
    const { ev } = setup();
    ev(use("t1", "TodoWrite", { todos: [{ content: "do it", status: "pending" }] }));
    ev(use("t2", "Bash", { command: "ls" }));
    const rows = document.querySelectorAll<HTMLDetailsElement>(".tool");
    expect(rows[0].open).toBe(true);
    expect(rows[1].open).toBe(false);
    expect(rows[1].querySelector(".term")!.textContent).toBe("$ ls");
  });
});

describe("sync from the transcript", () => {
  const sync = (items: object[]) => ({ t: "history", items, sync: true });

  it("replaces what is shown with the transcript, with no old-messages divider", () => {
    const { frame } = setup();
    frame({ t: "history", items: [{ role: "user", text: "one" }] });
    frame(sync([{ role: "user", text: "one" }, { role: "claude", text: "typed in another window" }]));
    expect(document.querySelectorAll(".msg").length).toBe(2);
    expect($(".chat-log").textContent).toContain("typed in another window");
    expect($(".chat-log").textContent).not.toContain("tin cũ");
  });

  it("waits for the running turn to finish before redrawing", () => {
    const { frame, ev } = setup();
    say("mine");
    ev(delta("partial"));
    frame(sync([{ role: "user", text: "mine" }, { role: "claude", text: "final" }]));
    expect($(".chat-log").textContent).toContain("partial");
    ev(result());
    expect($(".chat-log").textContent).toContain("final");
    expect($(".chat-log").textContent).not.toContain("partial");
    expect(document.querySelector(".think")).toBeNull();
  });

  it("shows a tool's diff from the transcript's input", () => {
    const { frame } = setup();
    frame(sync([{ role: "tool", name: "Edit", summary: "a.ts", input: { file_path: "a.ts", old_string: "x", new_string: "y" } }]));
    expect($(".tool .add").textContent).toBe("+ y");
  });

  it("recalls the synced messages with the arrow key", () => {
    const { frame } = setup();
    frame(sync([{ role: "user", text: "said elsewhere" }]));
    key("ArrowUp");
    expect(input().value).toBe("said elsewhere");
  });
});
