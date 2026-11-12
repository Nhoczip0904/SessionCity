import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { el } from "./launcher.js";

export interface TermDeps {
  makeTerm(): { open(el: HTMLElement): void; onData(cb: (d: string) => void): unknown; write(s: string): void; focus(): void; dispose(): void; cols: number; rows: number; fit(): void };
  WebSocket: typeof WebSocket;
}

const CHUNK = 16384;
let current: (() => void) | null = null;
export const isTerminalOpen = () => current !== null;

const defaultDeps: TermDeps = {
  makeTerm() {
    const t = new Terminal({ fontSize: 14, cursorBlink: true });
    const fit = new FitAddon();
    t.loadAddon(fit);
    return Object.assign(t, { fit: () => fit.fit() });
  },
  WebSocket: globalThis.WebSocket,
};

export function openTerminal(opts: { sessionId: string; title: string; token: string; onClose: () => void }, deps: TermDeps = defaultDeps): void {
  current?.();
  const root = el("div", undefined, "term-overlay");
  const box = el("div", undefined, "term-box");
  const bar = el("div", undefined, "term-bar");
  const x = el("button", "✕", "close");
  x.type = "button";
  x.title = "Đóng";
  const body = el("div", undefined, "term-body");
  bar.append(el("span", `Terminal — ${opts.title}`), x);
  box.append(bar, body);
  root.append(box);
  root.addEventListener("keydown", (e) => e.stopPropagation()); // Esc must not close the panel/scene behind
  document.body.append(root);

  const term = deps.makeTerm();
  term.open(body);
  term.fit();
  term.focus();

  const q = `token=${encodeURIComponent(opts.token)}&session=${encodeURIComponent(opts.sessionId)}&cols=${term.cols}&rows=${term.rows}`;
  const ws = new deps.WebSocket(`ws://${location.host}/pty?${q}`);
  let live = false;
  const send = (m: object) => ws.send(JSON.stringify(m));
  const onResize = () => {
    term.fit();
    if (live) send({ t: "size", cols: term.cols, rows: term.rows });
  };
  window.addEventListener("resize", onResize);

  ws.onopen = () => {
    live = true;
  };
  ws.onmessage = (e) => term.write(String(e.data));
  ws.onclose = (e) => {
    live = false;
    term.write(e.code === 4000 ? `\r\n[Phiên đã kết thúc (mã ${e.reason})]\r\n` : "\r\n[Không kết nối được terminal]\r\n");
  };
  term.onData((d) => {
    if (!live) return;
    for (let i = 0; i < d.length; i += CHUNK) send({ t: "in", d: d.slice(i, i + CHUNK) });
  });

  const close = () => {
    current = null;
    window.removeEventListener("resize", onResize);
    ws.onclose = ws.onmessage = null; // no writes into a disposed xterm
    ws.close();
    term.dispose();
    root.remove();
    opts.onClose();
  };
  x.onclick = close;
  current = close;
}
