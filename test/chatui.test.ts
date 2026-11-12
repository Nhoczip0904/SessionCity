// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isChatOpen, openChat, type ChatDeps } from "../src/client/chat.js";
import { openTerminal, type TermDeps } from "../src/client/term.js";

class FakeWS {
  static last: FakeWS;
  sent: string[] = [];
  closed = false;
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
const deps = { WebSocket: FakeWS as unknown as typeof WebSocket } as ChatDeps;

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
  document.querySelector<HTMLElement>(".chat-overlay .close")?.click();
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
    expect(row.querySelector("pre")!.textContent!.length).toBeLessThanOrEqual(5000);
    expect(row.querySelector("pre")!.textContent!.length).toBeGreaterThan(4000);
    ev(asst("m2", { type: "tool_use", id: "tu2", name: "Read", input: {} }));
    ev({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu2", content: [{ type: "text", text: "arr" }] }] }, parent_tool_use_id: null });
    expect(document.querySelectorAll(".tool")[1].querySelector("pre")!.textContent).toBe("arr");
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
    expect(links[0].getAttribute("rel")).toBe("noopener");
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
});
