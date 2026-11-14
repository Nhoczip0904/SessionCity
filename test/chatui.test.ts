// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isChatOpen, openChat, type ChatDeps } from "../src/client/chat.js";
import { openTerminal, type TermDeps } from "../src/client/term.js";

class FakeWS {
  static last: FakeWS;
  sent: string[] = [];
  closed = false;
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
  close() {
    this.closed = true;
  }
}
const deps = { WebSocket: FakeWS as unknown as typeof WebSocket, fetch: (async () => ({ ok: false })) as unknown as typeof fetch } as ChatDeps;

function setup() {
  const onClose = vi.fn();
  openChat({ sessionId: "abc", title: "proj", token: "t k", onClose }, deps);
  const ws = FakeWS.last;
  ws.onopen?.();
  const frame = (m: object) => ws.onmessage!({ data: JSON.stringify(m) });
  const ev = (e: object) => frame({ t: "ev", e });
  const sent = () => ws.sent.map((s) => JSON.parse(s));
  return { ws, frame, ev, sent, onClose };
}
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const textarea = () => $<HTMLTextAreaElement>(".chat-input textarea");
const sendBtn = () => $<HTMLButtonElement>(".chat-send");
const say = (text: string) => {
  textarea().value = text;
  textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};
const delta = (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, parent_tool_use_id: null });
const asst = (id: string, block: object) => ({ type: "assistant", message: { id, role: "assistant", content: [block] }, parent_tool_use_id: null });
const text = (t: string) => ({ type: "text", text: t });

afterEach(() => {
  document.querySelectorAll<HTMLElement>(".chat-overlay .close").forEach((x) => x.click());
  document.querySelector<HTMLElement>(".term-overlay .close")?.click();
  document.body.innerHTML = "";
});

describe("openChat", () => {
  it("builds url, shows title, is open", () => {
    const { ws } = setup();
    expect(ws.url).toBe(`ws://${location.host}/chat?token=t%20k&session=abc`);
    expect(document.body.textContent).toContain("Chat — proj");
    expect(isChatOpen()).toBe(true);
  });
  it("renders history with the old-messages divider", () => {
    const { frame } = setup();
    frame({ t: "history", items: [{ role: "user", text: "hi" }, { role: "claude", text: "**yo**" }, { role: "tool", name: "Bash", summary: "ls" }] });
    expect($(".chat-log").textContent).toContain("— tin cũ —");
    expect($(".msg.user").textContent).toBe("hi");
    expect($(".msg.claude strong").textContent).toBe("yo");
    expect($(".tool").textContent).toContain("Bash");
    expect($(".tool").textContent).toContain("ls");
  });
  it("streams deltas then replaces with the final message", () => {
    const { ev } = setup();
    ev(delta("Hel"));
    ev(delta("lo"));
    expect(document.querySelectorAll(".msg.claude").length).toBe(1);
    expect($(".msg.claude").textContent!.trim()).toBe("Hello");
    ev(asst("m1", text("Hello world")));
    expect(document.querySelectorAll(".msg.claude").length).toBe(1);
    expect($(".msg.claude").textContent!.trim()).toBe("Hello world");
    ev(asst("m1", { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }));
    expect(document.querySelectorAll(".msg.claude").length).toBe(1);
  });
  it("ignores subagent, system, rate-limit and other stream events", () => {
    const { ev } = setup();
    ev({ ...delta("sub"), parent_tool_use_id: "x" });
    ev({ type: "system", subtype: "init" });
    ev({ type: "rate_limit_event" });
    ev({ type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: null });
    expect(document.querySelector(".msg")).toBeNull();
  });
  it("tool rows collapse and show the result", () => {
    const { ev } = setup();
    ev(asst("m1", { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls -la" } }));
    const row = $<HTMLDetailsElement>(".tool");
    expect(row.open).toBe(false);
    expect(row.textContent).toContain("ls -la");
    ev({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "x".repeat(6000), is_error: false }] }, parent_tool_use_id: null });
    expect(row.querySelectorAll("pre")[1]!.textContent!.length).toBeLessThanOrEqual(5000);
    expect(row.querySelectorAll("pre")[1]!.textContent!.length).toBeGreaterThan(4000);
    ev(asst("m2", { type: "tool_use", id: "tu2", name: "Read", input: {} }));
    ev({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu2", content: [{ type: "text", text: "arr" }] }] }, parent_tool_use_id: null });
    expect(document.querySelectorAll(".tool")[1].querySelectorAll("pre")[1]!.textContent).toBe("arr");
  });
  it("permission card sends allow/deny once and locks", () => {
    const { ev, sent } = setup();
    const req = (id: string, input: object) => ev({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: "Write", input, tool_use_id: "t" } });
    req("r1", { file_path: "C:\\a.txt", content: "hi" });
    req("r2", { command: "rm x" });
    req("r3", { foo: "y".repeat(500) });
    const cards = document.querySelectorAll<HTMLElement>(".perm");
    expect(cards[0].textContent).toContain("C:\\a.txt");
    expect(cards[1].textContent).toContain("rm x");
    expect(cards[2].textContent!.length).toBeLessThan(450);
    const [allow, deny] = Array.from(cards[0].querySelectorAll("button"));
    expect(allow.textContent).toBe("Cho phép");
    expect(deny.textContent).toBe("Từ chối");
    allow.click();
    allow.click();
    deny.click();
    expect(sent()).toEqual([{ t: "allow", id: "r1" }]);
    expect(cards[0].textContent).toContain("Đã cho phép");
    expect(allow.disabled && deny.disabled).toBe(true);
    cards[1].querySelectorAll("button")[1].click();
    expect(sent()[1]).toEqual({ t: "deny", id: "r2" });
    expect(cards[1].textContent).toContain("Đã từ chối");
  });
  it("escapes html and drops unsafe links", () => {
    const { ev } = setup();
    ev(asst("m1", text("<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) ![p](http://e.x/p.png) [ok](https://a.b)")));
    const m = $(".msg.claude");
    expect(m.querySelector("img")).toBeNull();
    expect(m.querySelector("script")).toBeNull();
    expect(m.innerHTML).not.toContain("javascript:");
    expect(m.textContent).toContain("<script>");
    const links = m.querySelectorAll("a");
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toBe("https://a.b");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("user text and tool text are not parsed as html", () => {
    const { frame } = setup();
    frame({ t: "history", items: [{ role: "user", text: "<b>hi</b>" }, { role: "tool", name: "<i>x</i>", summary: "<u>y</u>" }] });
    expect(document.querySelector(".chat-log b, .chat-log i, .chat-log u")).toBeNull();
  });
  it("Enter sends, Shift+Enter newlines, empty ignored", () => {
    const { sent } = setup();
    say("   ");
    expect(sent()).toEqual([]);
    const shift = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    textarea().dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false);
    expect(sent()).toEqual([]);
    say("hello");
    expect(sent()).toEqual([{ t: "say", text: "hello" }]);
    expect(textarea().value).toBe("");
    expect($(".msg.user").textContent).toBe("hello");
  });
  it("Stop while answering", () => {
    const { ev, sent } = setup();
    expect(sendBtn().textContent).toBe("Gửi");
    say("go");
    expect(sendBtn().textContent).toBe("Dừng");
    sendBtn().click();
    expect(sent()[1]).toEqual({ t: "stop" });
    ev({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom" });
    expect(sendBtn().textContent).toBe("Gửi");
    expect($(".chat-log").textContent).toContain("Đã dừng");
    expect(document.querySelector(".chat-log .err")).toBeNull();
    say("again");
    textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sent().at(-1)).toEqual({ t: "stop" });
  });
  it("a message typed while answering is queued, then sent when the turn ends", () => {
    const { ev, sent } = setup();
    say("one");
    say("two");
    say("three");
    expect(sent().map((m) => m.text)).toEqual(["one"]);
    expect(document.querySelectorAll(".chat-queue .q").length).toBe(2);
    expect(textarea().value).toBe("");
    ev({ type: "result", subtype: "success" });
    expect(sent().map((m) => m.text)).toEqual(["one", "two"]); // one per turn, in order
    expect(document.querySelectorAll(".chat-queue .q").length).toBe(1);
    ev({ type: "result", subtype: "success" });
    expect(sent().map((m) => m.text)).toEqual(["one", "two", "three"]);
    expect(document.querySelectorAll(".chat-queue .q").length).toBe(0);
  });
  it("Gửi ngay sends a queued message into the running turn; ✕ drops one", () => {
    const { sent } = setup();
    say("one");
    say("two");
    say("three");
    $(".chat-queue .q .del").click(); // drops "two"
    $(".chat-queue .q .now").click(); // "three" now
    expect(sent().map((m) => m.text)).toEqual(["one", "three"]);
    expect(document.querySelectorAll(".chat-queue .q").length).toBe(0);
    expect($(".chat-log").textContent).toContain("three");
    expect($(".chat-log").textContent).not.toContain("two");
    expect(sendBtn().textContent).toBe("Dừng");
  });
  it("after Stop the queue waits instead of sending by itself", () => {
    const { ev, sent } = setup();
    say("one");
    say("two");
    sendBtn().click();
    ev({ type: "result", subtype: "error_during_execution", is_error: true, result: "x" });
    expect(sent().map((m) => m.text).filter(Boolean)).toEqual(["one"]);
    expect(document.querySelectorAll(".chat-queue .q").length).toBe(1);
  });
  it("the button reads Xếp hàng while answering with text typed, else Dừng", () => {
    setup();
    say("one");
    expect(sendBtn().textContent).toBe("Dừng");
    textarea().value = "next";
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
    expect(sendBtn().textContent).toBe("Xếp hàng");
    sendBtn().click();
    expect(document.querySelectorAll(".chat-queue .q").length).toBe(1);
  });
  it("Esc when idle sends nothing and does not reach document", () => {
    const { sent } = setup();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    $(".chat-box").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });
  it("result footer: cost, or error when not stopped", () => {
    const { ev } = setup();
    say("a");
    ev({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0.004 });
    expect($(".chat-log .foot").textContent).toContain("0.004");
    say("b");
    ev({ type: "result", subtype: "error_during_execution", is_error: true, result: "kaput" });
    expect($(".chat-log .err").textContent).toContain("kaput");
  });
  it("keeps scroll position when the user scrolled up", () => {
    const { ev } = setup();
    const log = $(".chat-log");
    Object.defineProperty(log, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(log, "clientHeight", { value: 300, configurable: true });
    log.scrollTop = 100;
    ev(asst("m1", text("one")));
    expect(log.scrollTop).toBe(100);
    log.scrollTop = 700;
    ev(asst("m2", text("two")));
    expect(log.scrollTop).toBe(1000);
  });
  it("4000 locks input with the end line; error shows the connect line", () => {
    const a = setup();
    a.ws.onclose!({ code: 4000, reason: "3" });
    expect($(".chat-log").textContent).toContain("Phiên đã kết thúc (mã 3)");
    expect(textarea().disabled).toBe(true);
    expect(sendBtn().disabled).toBe(true);
    expect(document.querySelector(".chat-overlay")).not.toBeNull();
    $(".chat-overlay .close").click();
    const b = setup();
    b.ws.onclose!({ code: 1006, reason: "" });
    expect($(".chat-log").textContent).toContain("Không kết nối được chat");
  });
  it("✕ cleans up and calls onClose", () => {
    const { ws, onClose } = setup();
    $(".chat-overlay .close").click();
    expect(ws.closed).toBe(true);
    expect(document.querySelector(".chat-overlay")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(isChatOpen()).toBe(false);
    expect(ws.onmessage).toBeNull();
  });
  it("one overlay at a time", () => {
    const a = setup();
    const b = setup();
    expect(a.ws.closed).toBe(true);
    expect(a.onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".chat-overlay").length).toBe(1);
    expect(b.ws).not.toBe(a.ws);
  });
  it("different sessions open as separate windows, no limit", () => {
    const open = (id: string) => {
      const onClose = vi.fn();
      openChat({ sessionId: id, title: id, token: "t", onClose }, deps);
      return { ws: FakeWS.last, onClose };
    };
    const a = open("s1");
    const b = open("s2");
    expect(a.ws.closed).toBe(false);
    expect(document.querySelectorAll(".chat-overlay").length).toBe(1);
    expect(document.querySelectorAll(".chat-box").length).toBe(2);
    const c = open("s3");
    expect(a.ws.closed).toBe(false);
    expect(b.ws.closed).toBe(false);
    expect(document.querySelectorAll(".chat-box").length).toBe(3);
    document.querySelectorAll<HTMLElement>(".chat-box .close")[1]!.click(); // closes s2
    expect(b.onClose).toHaveBeenCalledTimes(1);
    expect(c.ws.closed).toBe(false);
    expect(isChatOpen()).toBe(true);
    document.querySelectorAll<HTMLElement>(".chat-box .close").forEach((x) => x.click());
    expect(document.querySelector(".chat-overlay")).toBeNull();
    expect(isChatOpen()).toBe(false);
  });
  it("replace: the new session takes the place of the named chat box, in the same spot", () => {
    const open = (id: string, replace?: string) => {
      openChat({ sessionId: id, title: id, token: "t", onClose() {}, replace }, deps);
      return FakeWS.last;
    };
    const a = open("s1");
    const b = open("s2");
    const c = open("s3", "s1"); // s1 goes, s3 sits where s1 was (left)
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(false);
    expect([...document.querySelectorAll(".chat-bar > span")].map((s) => s.textContent)).toEqual(["Chat — s3", "Chat — s2"]);
    open("s2", "s3"); // already open elsewhere: nothing changes
    expect(c.closed).toBe(false);
    expect(document.querySelectorAll(".chat-box").length).toBe(2);
    const only = () => (document.querySelectorAll<HTMLElement>(".chat-box .close").forEach((x) => x.click()), open("s9"));
    only();
    open("s8", "s9"); // the only chat replaced
    expect(document.querySelectorAll(".chat-box").length).toBe(1);
    expect(document.querySelector(".chat-bar > span")!.textContent).toBe("Chat — s8");
  });
  it("Esc stops only the chat it is pressed in", () => {
    const open = (id: string) => {
      openChat({ sessionId: id, title: id, token: "t", onClose() {} }, deps);
      const ws = FakeWS.last;
      ws.onopen?.();
      ws.onmessage!({ data: JSON.stringify({ t: "ev", e: { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } } }) });
      ws.onmessage!({ data: JSON.stringify({ t: "ev", e: { type: "result" } }) });
      return ws;
    };
    const a = open("s1");
    const b = open("s2");
    const boxes = document.querySelectorAll<HTMLElement>(".chat-box");
    for (const [i, ws] of [a, b].entries()) {
      boxes[i]!.querySelector<HTMLTextAreaElement>("textarea")!.value = "go";
      boxes[i]!.querySelector<HTMLButtonElement>(".chat-send")!.click();
      expect(ws.sent.length).toBeGreaterThan(0);
    }
    a.sent.length = b.sent.length = 0;
    boxes[0]!.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(a.sent.map((s) => JSON.parse(s).t)).toEqual(["stop"]);
    expect(b.sent).toEqual([]);
  });
  it("does not open while a terminal is open", () => {
    const term = { cols: 1, rows: 1, open() {}, onData() {}, write() {}, focus() {}, dispose() {}, fit() {} };
    openTerminal({ sessionId: "abc", title: "p", token: "t", onClose() {} }, { makeTerm: () => term, WebSocket: FakeWS as unknown as typeof WebSocket } as TermDeps);
    openChat({ sessionId: "abc", title: "p", token: "t", onClose() {} }, deps);
    expect(document.querySelector(".chat-overlay")).toBeNull();
    expect(isChatOpen()).toBe(false);
  });
  it("copy button on code blocks", () => {
    const { ev } = setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    ev(asst("m1", text("```js\nlet a = 1;\n```")));
    const btn = $(".msg.claude button");
    expect(btn.textContent).toBe("Sao chép");
    btn.click();
    expect(writeText).toHaveBeenCalledWith("let a = 1;\n");
  });
  it("tool row shows input json above the result, with prefix", () => {
    const { ev } = setup();
    ev(asst("m1", { type: "tool_use", id: "tu1", name: "Grep", input: { command: "ls", big: "z".repeat(6000) } }));
    const row = $(".tool");
    expect(row.querySelector("summary")!.textContent).toBe("\u{1F527} Grep — ls");
    const pres = row.querySelectorAll("pre");
    expect(pres.length).toBe(2);
    expect(pres[0].textContent!.startsWith('{\n  "command": "ls"')).toBe(true);
    expect(pres[0].textContent!.length).toBeLessThanOrEqual(5000);
  });
  it("result footer shows duration and cost", () => {
    const { ev } = setup();
    say("a");
    ev({ type: "result", subtype: "success", is_error: false, duration_ms: 8228, total_cost_usd: 0.004 });
    expect($(".chat-log .foot").textContent).toBe("8.2s · $0.0040");
  });
  it("Esc with focus outside the textarea is contained and stops claude", () => {
    const { sent } = setup();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sent()).toEqual([]);
    say("go");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
    expect(sent().at(-1)).toEqual({ t: "stop" });
  });
  it("does not send or get stuck before the socket is open", () => {
    const { ws, sent } = setup();
    ws.readyState = 0;
    say("hello");
    expect(sent()).toEqual([]);
    expect(textarea().value).toBe("hello");
    expect(sendBtn().textContent).toBe("Gửi");
  });
  it("result disables pending permission cards", () => {
    const { ev, sent } = setup();
    ev({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Write", input: {} } });
    ev({ type: "result", subtype: "success", is_error: false });
    const b = $(".perm button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    b.click();
    expect(sent()).toEqual([]);
  });
  it("a permission request from a subagent still shows a card", () => {
    const { ev } = setup();
    ev({ type: "control_request", request_id: "r9", parent_tool_use_id: "toolu_x", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
    expect(document.querySelector(".perm")).not.toBeNull();
    ev({ type: "assistant", parent_tool_use_id: "toolu_x", message: { id: "m", content: [{ type: "text", text: "sub" }] } });
    expect(document.querySelector(".msg.claude")).toBeNull();
  });
  it("Esc during IME composition does not stop claude", () => {
    const { sent } = setup();
    say("go");
    textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    expect(sent().filter((m) => m.t === "stop")).toEqual([]);
    textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sent().at(-1)).toEqual({ t: "stop" });
  });
  it("openTerminal does nothing while a chat is open", () => {
    setup();
    const makeTerm = vi.fn();
    openTerminal({ sessionId: "abc", title: "p", token: "t", onClose: vi.fn() }, { makeTerm, WebSocket: FakeWS as unknown as typeof WebSocket } as unknown as TermDeps);
    expect(makeTerm).not.toHaveBeenCalled();
    expect(document.querySelector(".term-overlay")).toBeNull();
  });
});

describe("chat footer", () => {
  const meta = { model: "claude-sonnet-5-5", used: 126_000, outputs: ["C:/p/out.ts"], changes: [{ repo: "r", files: [{ path: "a.ts", status: "M", add: 4, del: 1 }] }] };
  const open = async (m: unknown) => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => m }) as Response);
    openChat({ sessionId: "abc", title: "p", token: "t", onClose() {} }, { ...deps, fetch: fetchMock as unknown as typeof fetch });
    await new Promise((r) => setTimeout(r, 0));
    return fetchMock;
  };
  it("shows model, context meter, changes and outputs; picking a model or mode sends a frame", async () => {
    const f = await open(meta);
    expect(String(f.mock.calls[0]![0])).toBe("/api/session/abc/meta?token=t");
    expect($<HTMLSelectElement>(".chat-pick").value).toBe("claude-sonnet-5-5");
    expect($(".chat-meter small").textContent).toBe("63% · 126k/200k");
    expect($(".chat-meta summary").textContent).toBe("Thay đổi 1 · Kết quả 1");
    expect($(".chat-meta .chg").textContent).toContain("a.ts");
    expect($(".chat-meta .out li").textContent).toBe("out.ts");
    const ws = FakeWS.last;
    const [model, mode] = Array.from(document.querySelectorAll<HTMLSelectElement>(".chat-pick"));
    model!.value = "claude-opus-5-5";
    model!.dispatchEvent(new Event("change"));
    mode!.value = "plan";
    mode!.dispatchEvent(new Event("change"));
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ t: "model", model: "claude-opus-5-5" }, { t: "mode", mode: "plan" }]);
  });
  it("offers Tự động but not bypass-permissions as a mode", async () => {
    await open(meta);
    const mode = document.querySelectorAll<HTMLSelectElement>(".chat-pick")[1]!;
    const values = Array.from(mode.options).map((o) => o.value);
    expect(values).toContain("auto");
    expect(values).not.toContain("bypassPermissions");
    mode.value = "auto";
    mode.dispatchEvent(new Event("change"));
    expect(JSON.parse(FakeWS.last.sent.at(-1)!)).toEqual({ t: "mode", mode: "auto" });
  });
  it("shows the mode the server says is in force, and says so when a change is refused", async () => {
    await open(null);
    const mode = document.querySelectorAll<HTMLSelectElement>(".chat-pick")[1]!;
    FakeWS.last.onmessage!({ data: JSON.stringify({ t: "ev", e: { type: "mode", mode: "auto" } }) });
    expect(mode.value).toBe("auto");
    FakeWS.last.onmessage!({ data: JSON.stringify({ t: "ev", e: { type: "control_response", response: { subtype: "error", request_id: "mode-3", error: "không được" } } }) });
    expect($(".chat-log .err").textContent).toContain("không được");
  });
  it("hides what it does not know when the meta cannot be had", async () => {
    await open(null);
    expect($<HTMLElement>(".chat-meter").hidden).toBe(true);
    expect($<HTMLElement>(".chat-meta").hidden).toBe(true);
    expect($<HTMLElement>(".chat-pick").hidden).toBe(true);
  });
  it("an image from the file input goes with the message, and the chips clear", async () => {
    await open(null);
    const input = $<HTMLInputElement>(".chat-input input[type=file]");
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" })] });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelectorAll(".chat-chips .chip").length).toBe(1);
    sendBtn().click();
    expect(FakeWS.last.sent.map((s) => JSON.parse(s))).toEqual([{ t: "say", text: "", images: [{ media_type: "image/png", data: "AQID" }] }]);
    expect(document.querySelectorAll(".chat-chips .chip").length).toBe(0);
  });
});

describe("chat title avatar", () => {
  const open = (face: string | null) =>
    openChat({ sessionId: "abc", title: "proj", token: "t", onClose: () => {}, menu: { sessions: () => [], avatarOf: () => face, pick: () => {} } }, deps);

  it("shows the mayor's face next to the title", () => {
    open("data:image/png;base64,AA");
    expect($<HTMLImageElement>(".chat-bar img.chat-ava").src).toBe("data:image/png;base64,AA");
    expect($(".chat-bar").textContent).toContain("Chat — proj");
  });

  it("has no image when the session has no face yet", () => {
    open(null);
    expect(document.querySelector(".chat-bar img")).toBeNull();
  });
});
