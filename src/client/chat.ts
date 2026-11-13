import { Marked } from "marked";
import type { Session } from "../shared/types.js";
import { sessionMenu } from "./chatMenu.js";
import { toolBody } from "./chatTools.js";
import { el } from "./launcher.js";
import { isTerminalOpen } from "./term.js";

export interface ChatDeps {
  WebSocket: typeof WebSocket;
}

const MAX_RESULT = 5000;
const MAX_MAIN = 300;
const MAX_INPUT = 200; // px: the input stops growing here and scrolls
let current: (() => void) | null = null;
export const isChatOpen = () => current !== null;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// raw html is escaped, images never load, only http(s) links survive
const md = new Marked({
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text),
    link(this: { parser: { parseInline(t: unknown): string } }, { href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      return /^https?:\/\//i.test(href.trim()) ? `<a href="${esc(href.trim())}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
    },
  },
});

const defaultDeps: ChatDeps = { WebSocket: globalThis.WebSocket };

interface Bubble {
  box: HTMLElement;
  id: string;
  done: string;
  live: string;
}
interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

const mainLine = (input: Record<string, unknown> = {}) =>
  String(input.command ?? input.file_path ?? JSON.stringify(input)).slice(0, MAX_MAIN);

/** `menu`: lets the person hop to another session from beside the chat. */
export interface ChatMenu { sessions(): Session[]; avatarOf(id: string): string | null; pick(id: string): void }

export function openChat(opts: { sessionId: string; title: string; token: string; onClose: () => void; menu?: ChatMenu }, deps: ChatDeps = defaultDeps): void {
  if (isTerminalOpen()) return;
  current?.();
  const root = el("div", undefined, "chat-overlay");
  const box = el("div", undefined, "chat-box");
  const bar = el("div", undefined, "chat-bar");
  const x = el("button", "✕", "close");
  x.type = "button";
  x.title = "Đóng";
  const log = el("div", undefined, "chat-log");
  const form = el("div", undefined, "chat-input");
  const input = el("textarea");
  input.rows = 1;
  input.placeholder = "Nhắn cho Claude…";
  const btn = el("button", "Gửi", "chat-send");
  btn.type = "button";
  form.append(input, btn);
  bar.append(el("span", `Chat — ${opts.title}`), x);
  box.append(bar, log, form);
  if (opts.menu) root.append(sessionMenu(opts.menu.sessions(), opts.sessionId, opts.menu.avatarOf, opts.menu.pick));
  root.append(box);
  root.addEventListener("keydown", (e) => e.stopPropagation()); // Esc must not close the panel/scene behind
  // keep focus in the input: a click on the bar or backdrop would send it to <body>
  root.addEventListener("mousedown", (e) => {
    const t = e.target as Node;
    if (t === x || t === input || log.contains(t) || btn.contains(t) || (t as Element).closest?.(".chat-side")) return;
    e.preventDefault();
    input.focus();
  });
  document.body.append(root);
  input.focus();

  const q = `token=${encodeURIComponent(opts.token)}&session=${encodeURIComponent(opts.sessionId)}`;
  const ws = new deps.WebSocket(`ws://${location.host}/chat?${q}`);
  const send = (m: object) => ws.send(JSON.stringify(m));

  let answering = false;
  const sent: string[] = []; // what was said, oldest first, for the arrow keys
  let hi = 0; // index into sent while browsing it; sent.length when not
  let stopped = false;
  let locked = false;
  let cur: Bubble | null = null;
  const tools = new Map<string, HTMLElement>(); // tool_use_id -> result <pre>

  // append to the log; stay glued to the bottom unless the user scrolled up
  const stick = (fn: () => void) => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    fn();
    if (answering) log.append(think); // always the last thing in the log
    if (atBottom) log.scrollTop = log.scrollHeight;
  };
  const add = (n: HTMLElement) => stick(() => log.append(n));
  const note = (text: string, cls: string) => add(el("div", text, cls));
  const think = el("div", undefined, "think");
  think.append(el("span", undefined, "dots"), el("span", "Claude đang làm…"));
  const setAnswering = (a: boolean) => {
    answering = a;
    btn.textContent = a ? "Dừng" : "Gửi";
    if (a) log.append(think);
    else {
      think.remove();
      log.querySelectorAll(".typing").forEach((n) => n.classList.remove("typing"));
    }
  };

  const render = (b: Bubble) =>
    stick(() => {
      b.box.classList.toggle("typing", answering); // a blinking cursor at the end of what is being written
      const src = b.done + (b.done && b.live ? "\n\n" : "") + b.live;
      b.box.innerHTML = md.parse(src, { async: false }) as string; // the only innerHTML: marked output, html escaped above
      for (const pre of Array.from(b.box.querySelectorAll("pre"))) {
        const wrap = el("div", undefined, "code");
        const copy = el("button", "Sao chép", "copy");
        copy.type = "button";
        copy.onclick = () => void navigator.clipboard?.writeText(pre.textContent ?? "");
        pre.replaceWith(wrap);
        wrap.append(pre, copy);
      }
    });
  const bubble = (id: string): Bubble => {
    const b = { box: el("div", undefined, "msg claude"), id, done: "", live: "" };
    add(b.box);
    return b;
  };
  const userMsg = (text: string) => add(el("div", text, "msg user"));
  const toolRow = (name: string, summary: string, inp?: Record<string, unknown>) => {
    const d = el("details", undefined, "tool");
    const s = el("summary");
    s.append(el("span", `\u{1F527} ${name} `, "tname"), el("span", `\u2014 ${summary}`));
    const out = el("pre");
    if (inp) d.append(s, toolBody(name, inp) ?? el("pre", (JSON.stringify(inp, null, 2) ?? "").slice(0, MAX_RESULT)), out);
    else d.append(s, out);
    d.open = name === "TodoWrite"; // the plan is worth seeing without a click
    add(d);
    return out;
  };

  const onEv = (e: any) => {
    if (!e) return;
    // subagent traffic is hidden, but its permission prompts must show or claude waits forever
    if (e.parent_tool_use_id && e.type !== "control_request") return;
    switch (e.type) {
      case "stream_event": {
        const d = e.event?.type === "content_block_delta" ? e.event.delta : null;
        if (d?.type !== "text_delta" || typeof d.text !== "string") return;
        cur ??= bubble("");
        cur.live += d.text;
        render(cur);
        return;
      }
      case "assistant": {
        const id = String(e.message?.id ?? "");
        if (cur && cur.id && cur.id !== id) cur = null;
        for (const c of (e.message?.content ?? []) as Block[]) {
          if (c.type === "text" && typeof c.text === "string") {
            cur ??= bubble(id);
            cur.id = id;
            cur.done += (cur.done ? "\n\n" : "") + c.text;
            cur.live = "";
            render(cur);
          } else if (c.type === "tool_use" && c.id) {
            const todos = c.name === "TodoWrite" && Array.isArray(c.input?.todos) ? c.input.todos.length : -1;
            tools.set(c.id, toolRow(c.name ?? "tool", todos >= 0 ? `${todos} việc` : mainLine(c.input), c.input ?? {}));
          }
        }
        return;
      }
      case "user": {
        cur = null;
        const c = e.message?.content;
        if (!Array.isArray(c)) return;
        for (const r of c as Block[]) {
          const out = r.type === "tool_result" && r.tool_use_id ? tools.get(r.tool_use_id) : undefined;
          if (!out) continue;
          const t = typeof r.content === "string" ? r.content : Array.isArray(r.content) ? r.content.map((p: Block) => p.text ?? "").join("") : "";
          out.textContent = t.slice(0, MAX_RESULT);
        }
        return;
      }
      case "control_request": {
        const r = e.request;
        if (r?.subtype !== "can_use_tool") return;
        const id = String(e.request_id);
        const card = el("div", undefined, "perm");
        const ok = el("button", "Cho phép", "allow");
        const no = el("button", "Từ chối", "deny");
        ok.type = no.type = "button";
        const status = el("span", undefined, "status");
        const decide = (t: "allow" | "deny") => {
          if (ok.disabled) return;
          ok.disabled = no.disabled = true;
          status.textContent = t === "allow" ? "Đã cho phép" : "Đã từ chối";
          send({ t, id });
        };
        ok.onclick = () => decide("allow");
        no.onclick = () => decide("deny");
        const acts = el("div", undefined, "acts");
        acts.append(ok, no, status);
        card.append(el("div", String(r.tool_name ?? "Tool"), "ptool"), el("pre", mainLine(r.input)), acts);
        add(card);
        return;
      }
      case "result": {
        cur = null;
        setAnswering(false);
        root.querySelectorAll<HTMLButtonElement>(".perm button").forEach((b) => (b.disabled = true)); // unanswered cards are stale
        if (e.is_error && e.subtype === "error_during_execution" && stopped) note("Đã dừng", "foot");
        else if (e.is_error) note(String(e.result ?? e.subtype ?? "error"), "err");
        else {
          const parts = [typeof e.duration_ms === "number" ? `${(e.duration_ms / 1000).toFixed(1)}s` : "", typeof e.total_cost_usd === "number" ? `$${e.total_cost_usd.toFixed(4)}` : ""].filter(Boolean);
          if (parts.length) note(parts.join(" \u00b7 "), "foot");
        }
        stopped = false;
        return;
      }
    }
  };

  ws.onmessage = (m) => {
    let f: any;
    try {
      f = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (f?.t === "history" && Array.isArray(f.items)) {
      for (const h of f.items) {
        if (h.role === "user") {
          userMsg(String(h.text));
          sent.push(String(h.text));
          hi = sent.length;
        }
        else if (h.role === "claude") {
          const b = bubble("");
          b.done = String(h.text);
          render(b);
        } else if (h.role === "tool") toolRow(String(h.name), String(h.summary));
      }
      if (f.items.length) note("— tin cũ —", "divider");
    } else if (f?.t === "ev") onEv(f.e);
  };
  ws.onclose = (e) => {
    locked = true;
    setAnswering(false);
    input.disabled = btn.disabled = true;
    note(e.code === 4000 ? `Phiên đã kết thúc (mã ${e.reason})` : "Không kết nối được chat", "err");
  };

  const OPEN = 1; // WebSocket.OPEN: send() throws before this
  const stop = () => {
    if (ws.readyState !== OPEN) return;
    stopped = true;
    send({ t: "stop" });
  };
  const submit = () => {
    if (locked || ws.readyState !== OPEN) return;
    if (answering) return stop();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.style.height = "auto";
    sent.push(text);
    hi = sent.length;
    userMsg(text);
    cur = null;
    stopped = false;
    setAnswering(true);
    send({ t: "say", text });
  };
  btn.onclick = submit;
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT)}px`;
  };
  input.addEventListener("input", grow);
  const recall = (to: number) => {
    hi = to;
    input.value = sent[hi] ?? "";
    input.setSelectionRange(input.value.length, input.value.length);
    grow();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!answering) submit();
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.isComposing && !e.shiftKey) {
      // earlier messages, like a shell: only when it cannot be a caret move (empty box, caret at the edge, or already browsing)
      const browsing = hi < sent.length && input.value === sent[hi];
      const atStart = input.value === "" || (input.selectionStart === 0 && input.selectionEnd === 0);
      const atEnd = input.selectionStart === input.value.length;
      if (e.key === "ArrowUp" && sent.length && hi > 0 && (browsing || atStart)) {
        e.preventDefault();
        recall(hi - 1);
      } else if (e.key === "ArrowDown" && browsing && atEnd) {
        e.preventDefault();
        recall(hi + 1);
      }
    }
  });
  // focus can sit on a bubble/button/body: Esc must still stop claude and not reach panel/scene handlers
  const onDocKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (answering && !e.isComposing) stop(); // Esc during IME composition only cancels the composition
    } else if (!root.contains(e.target as Node)) e.stopPropagation();
  };
  document.addEventListener("keydown", onDocKey, true);

  const close = () => {
    current = null;
    document.removeEventListener("keydown", onDocKey, true);
    ws.onclose = ws.onmessage = null;
    ws.close();
    root.remove();
    opts.onClose();
  };
  x.onclick = close;
  current = close;
}
