// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTerminalOpen, openTerminal, type TermDeps } from "../src/client/term.js";

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

function setup() {
  const term = {
    cols: 100,
    rows: 30,
    written: [] as string[],
    data: (_d: string) => {},
    disposed: false,
    open: vi.fn(),
    onData(cb: (d: string) => void) {
      term.data = cb;
    },
    write(s: string) {
      term.written.push(s);
    },
    focus: vi.fn(),
    dispose() {
      term.disposed = true;
    },
    fit: vi.fn(),
  };
  const deps = { makeTerm: () => term, WebSocket: FakeWS as unknown as typeof WebSocket } as TermDeps;
  const onClose = vi.fn();
  openTerminal({ sessionId: "abc", title: "proj", token: "t k", onClose }, deps);
  return { term, ws: FakeWS.last, onClose };
}

afterEach(() => {
  document.querySelector(".term-overlay button")?.dispatchEvent(new Event("click"));
  document.body.innerHTML = "";
});

describe("openTerminal", () => {
  it("builds url after fit, shows title, is open", () => {
    const { term, ws } = setup();
    expect(term.fit).toHaveBeenCalled();
    expect(ws.url).toBe(`ws://${location.host}/pty?token=t%20k&session=abc&cols=100&rows=30`);
    expect(document.body.textContent).toContain("Terminal — proj");
    expect(isTerminalOpen()).toBe(true);
  });
  it("sends input and chunks big input", () => {
    const { term, ws } = setup();
    ws.onopen!();
    term.data("ab");
    expect(JSON.parse(ws.sent[0])).toEqual({ t: "in", d: "ab" });
    ws.sent.length = 0;
    const big = "x".repeat(100000);
    term.data(big);
    const ds = ws.sent.map((s) => JSON.parse(s).d as string);
    expect(ds.length).toBeGreaterThan(1);
    expect(ds.every((d) => d.length <= 16384)).toBe(true);
    expect(ds.join("")).toBe(big);
  });
  it("resize: nothing before open, size after", () => {
    const { ws } = setup();
    window.dispatchEvent(new Event("resize"));
    expect(ws.sent).toEqual([]);
    ws.onopen!();
    window.dispatchEvent(new Event("resize"));
    expect(JSON.parse(ws.sent[0])).toEqual({ t: "size", cols: 100, rows: 30 });
  });
  it("Esc inside overlay does not reach document", () => {
    setup();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    document.querySelector(".term-box")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
  });
  it("✕ tears everything down", () => {
    const { term, ws, onClose } = setup();
    document.querySelector<HTMLElement>(".term-overlay button")!.click();
    expect(ws.closed).toBe(true);
    expect(term.disposed).toBe(true);
    expect(document.querySelector(".term-overlay")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(isTerminalOpen()).toBe(false);
    ws.onclose?.({ code: 1006, reason: "" });
    window.dispatchEvent(new Event("resize"));
    expect(ws.sent).toEqual([]);
  });
  it("writes server output", () => {
    const { term, ws } = setup();
    ws.onmessage!({ data: "out" });
    expect(term.written).toEqual(["out"]);
  });
  it("code 4000 shows exit code and keeps overlay", () => {
    const { term, ws } = setup();
    ws.onopen!();
    ws.onclose!({ code: 4000, reason: "3" });
    expect(term.written.join("")).toContain("Phiên đã kết thúc (mã 3)");
    expect(document.querySelector(".term-overlay")).not.toBeNull();
  });
  it("other close shows connect failure", () => {
    const a = setup();
    a.ws.onclose!({ code: 1006, reason: "" });
    expect(a.term.written.join("")).toContain("Không kết nối được terminal");
    document.querySelector<HTMLElement>(".term-overlay button")!.click();
    const b = setup();
    b.ws.onopen!();
    b.ws.onclose!({ code: 1001, reason: "" });
    expect(b.term.written.join("")).toContain("Không kết nối được terminal");
  });
});
