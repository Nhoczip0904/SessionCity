import { Marked } from "marked";
import { NOTE_DRAG } from "../shared/notes.js";
import type { Session } from "../shared/types.js";
import { blurSlider } from "./chatBlur.js";
import { chatFooter, picThumbs } from "./chatFooter.js";
import { shelfStrip } from "./chatShelf.js";
import { staffStrip } from "./chatStaff.js";
import { jobStrip } from "./chatJobs.js";
import { SESSION_DRAG, markOpen, sessionMenu } from "./chatMenu.js";
import { questionsOf, renderQuestions } from "./askQuestion.js";
import { toolBody } from "./chatTools.js";
import { defaultGeo, floatable, loadGeo, saveGeo, type Geo } from "./chatWin.js";
import { el } from "./launcher.js";
import { isTerminalOpen } from "./term.js";

export interface ChatDeps {
  WebSocket: typeof WebSocket;
  fetch?: typeof fetch;
}

const MAX_RESULT = 5000;
const MAX_MAIN = 300;
const MAX_INPUT = 200; // px: the input stops growing here and scrolls
const open: { id: string; box: HTMLElement; close: () => void; geo: () => Geo }[] = []; // oldest first
let shared: HTMLElement | null = null; // the drawer: the session menu and every open chat box
export const isChatOpen = () => open.length > 0;

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
export interface ChatMenu { sessions(): Session[]; avatarOf(id: string): string | null; pick(id: string, replace?: string): void }

export function openChat(opts: { sessionId: string; title: string; onClose: () => void; menu?: ChatMenu; replace?: string }, deps: ChatDeps = defaultDeps): void {
  if (isTerminalOpen()) return;
  // `replace`: the box of that session is swapped for this one, in its spot; a session already open elsewhere stays as it is
  const old = opts.replace ? open.find((c) => c.id === opts.replace) : undefined;
  if (old && open.some((c) => c.id === opts.sessionId && c !== old)) return;
  const slot = old?.box.nextSibling ?? null;
  const inherited = old?.geo(); // a replacing window takes the old one's place and size
  // the same session again reopens fresh
  open.find((c) => c.id === opts.sessionId)?.close();
  old?.close();
  const fresh = !shared;
  const root = (shared ??= el("div", undefined, "chat-overlay"));
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
  const q = `session=${encodeURIComponent(opts.sessionId)}`;
  const ws = new deps.WebSocket(`ws://${location.host}/chat?${q}`);
  const send = (m: object) => ws.send(JSON.stringify(m));
  const foot = chatFooter({
    send,
    note: (t) => note(t, "err"),
    meta: () =>
      (deps.fetch ?? globalThis.fetch)(`/api/session/${encodeURIComponent(opts.sessionId)}/meta`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
  });
  form.append(foot.plus, foot.file, input, btn);
  const name = el("span", `Chat — ${opts.title}`);
  const face = opts.menu?.avatarOf(opts.sessionId);
  if (face) {
    const img = el("img", undefined, "chat-ava");
    img.src = face;
    img.alt = ""; // the title next to it says who this is
    name.prepend(img);
  }
  // open a console / the file manager at this session's folder; the server picks the path itself
  const tool = (cls: string, label: string, title: string, what: "cmd" | "folder") => {
    const b = el("button", label, `minb ${cls}`);
    b.type = "button";
    b.title = title;
    b.onclick = () => void (deps.fetch ?? globalThis.fetch)(`/api/session/${encodeURIComponent(opts.sessionId)}/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what }) }).then((r) => r.ok || note(`Không mở được (${r.status})`, "err"), () => note("Không mở được", "err"));
    return b;
  };
  const more = el("div", undefined, "chat-more"); // dropdown: blur slider, open cmd, open folder
  const menu = el("div", undefined, "chat-more-menu");
  menu.hidden = true;
  menu.append(blurSlider(), tool("open-cmd", ">_", "Mở cmd tại thư mục của chat này", "cmd"), tool("open-dir", "📁", "Mở thư mục của chat này", "folder"));
  const dots = el("button", "⋯", "minb");
  dots.type = "button";
  dots.title = "Độ mờ, mở cmd, mở thư mục";
  dots.onclick = () => (menu.hidden = !menu.hidden);
  more.append(dots, menu);
  document.addEventListener("pointerdown", (e) => void (more.contains(e.target as Node) || (menu.hidden = true)), true); // shortcut: listener stays until reload, when many chats open
  bar.append(name, more, x);
  const jobs = jobStrip();
  const qbox = el("div", undefined, "chat-queue"); // messages typed while claude answers, waiting their turn
  const side = el("div", undefined, "chat-drawers"); // right-edge drawers: bookshelf (files) over medicine cabinet (tests)
  const edge = el("button", undefined, "chat-edge"); // arrow on the right edge of the chat: hides / shows the panel
  edge.type = "button";
  edge.title = "Ẩn / hiện bảng bên phải";
  edge.onclick = () => box.classList.toggle("no-side");
  side.append(shelfStrip(opts.sessionId, deps.fetch), jobs.el);
  box.append(bar, log, side, edge, staffStrip(opts.sessionId), foot.panel, foot.chips, qbox, form, foot.bar);
  const win = floatable(box, bar, inherited ?? loadGeo(opts.sessionId) ?? defaultGeo(open.length, innerWidth, innerHeight), (g) => saveGeo(opts.sessionId, g));
  if (opts.menu && fresh) root.append(sessionMenu(opts.menu.sessions(), opts.sessionId, opts.menu.avatarOf, opts.menu.pick));
  root.insertBefore(box, slot && root.contains(slot) ? slot : null);
  // a session dragged from the menu onto this box takes its place
  const carrying = (e: DragEvent) => !!opts.menu && !!e.dataTransfer?.types.includes(SESSION_DRAG);
  // a sticky note dragged from the city drops its text into the input
  const noteDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes(NOTE_DRAG);
  box.addEventListener("dragover", (e) => {
    if (!carrying(e) && !noteDrag(e)) return;
    e.preventDefault(); // allows the drop
    if (noteDrag(e)) e.dataTransfer!.dropEffect = "copy"; // the note offers "copy" only; any other effect makes the browser refuse the drop
    box.classList.add("dropping");
  });
  box.addEventListener("dragleave", (e) => void (e.relatedTarget && box.contains(e.relatedTarget as Node) || box.classList.remove("dropping")));
  box.addEventListener("drop", (e) => {
    box.classList.remove("dropping");
    if (noteDrag(e)) {
      e.preventDefault(); // not the browser's own insert, which would only work over the textarea
      input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + e.dataTransfer!.getData("text/plain");
      input.focus();
      return;
    }
    if (!carrying(e)) return;
    e.preventDefault();
    const id = e.dataTransfer!.getData(SESSION_DRAG);
    if (id !== opts.sessionId && opts.menu!.sessions().some((s) => s.id === id)) opts.menu!.pick(id, opts.sessionId);
  });
  box.addEventListener("keydown", (e) => e.stopPropagation()); // Esc must not close the panel/scene behind
  // keep focus in the input: a click on the bar or backdrop would send it to <body>
  box.addEventListener("mousedown", (e) => {
    const t = e.target as Node;
    if (t === x || t === input || log.contains(t) || btn.contains(t) || (t as Element).closest?.(".chat-side, .chat-extra, .blur-range")) return;
    e.preventDefault();
    input.focus();
  });
  if (fresh) document.body.append(root);
  input.focus();

  foot.refresh();

  let answering = false;
  let later: any[] | null = null; // a sync that arrived during our own turn
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
  const queue: { text: string; pics: ReturnType<typeof foot.images> }[] = [];
  // while answering, the button queues what is typed and stops when nothing is
  const label = () => (btn.textContent = !answering ? "Gửi" : input.value.trim() || foot.images().length ? "Xếp hàng" : "Dừng");
  const setAnswering = (a: boolean) => {
    answering = a;
    label();
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
  const userMsg = (text: string, pics: ReturnType<typeof foot.images> = []) => {
    const m = el("div", text, "msg user");
    if (pics.length) m.append(picThumbs(pics));
    add(m);
  };
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
      case "mode":
        if (typeof e.mode === "string") foot.setMode(e.mode);
        return;
      case "control_response":
        if (e.response?.subtype === "error" && /^(mode|mdl)-/.test(String(e.response.request_id))) note(String(e.response.error ?? "Không đổi được"), "err");
        return;
      case "control_request": {
        const r = e.request;
        if (r?.subtype !== "can_use_tool") return;
        const id = String(e.request_id);
        const qs = r.tool_name === "AskUserQuestion" ? questionsOf(r.input) : null;
        if (qs) {
          add(renderQuestions(qs, (answers) => send({ t: "allow", id, answers }), () => send({ t: "deny", id })));
          return;
        }
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
        box.querySelectorAll<HTMLButtonElement>(".perm button").forEach((b) => (b.disabled = true)); // unanswered cards are stale
        if (e.is_error && e.subtype === "error_during_execution" && stopped) note("Đã dừng", "foot");
        else if (e.is_error) note(String(e.result ?? e.subtype ?? "error"), "err");
        else {
          const parts = [typeof e.duration_ms === "number" ? `${(e.duration_ms / 1000).toFixed(1)}s` : "", typeof e.total_cost_usd === "number" ? `$${e.total_cost_usd.toFixed(4)}` : ""].filter(Boolean);
          if (parts.length) note(parts.join(" \u00b7 "), "foot");
        }
        const wasStopped = stopped;
        stopped = false;
        foot.refresh();
        if (later) resync(later);
        const next = wasStopped || locked ? undefined : queue.shift(); // after Stop the queue waits for the person
        if (next) (drawQueue(), transmit(next.text, next.pics));
        return;
      }
    }
  };

  const showHistory = (items: any[]) => {
    for (const h of items) {
      if (h.role === "user") {
        userMsg(String(h.text));
        sent.push(String(h.text));
        hi = sent.length;
      } else if (h.role === "claude") {
        const b = bubble("");
        b.done = String(h.text);
        render(b);
      } else if (h.role === "tool") toolRow(String(h.name), String(h.summary), h.input && typeof h.input === "object" ? h.input : undefined);
    }
  };
  /** The transcript changed elsewhere (another window on this session): show it as it now stands. */
  const resync = (items: any[]) => {
    later = null;
    stick(() => {
      log.replaceChildren();
      cur = null;
      tools.clear();
      sent.length = 0;
      showHistory(items);
      hi = sent.length;
    });
  };
  ws.onmessage = (m) => {
    let f: any;
    try {
      f = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (f?.t === "history" && Array.isArray(f.items)) {
      if (!f.sync) {
        showHistory(f.items);
        if (f.items.length) note("— tin cũ —", "divider");
      } else if (answering) later = f.items; // redrawing mid-turn would cut the reply being written
      else resync(f.items);
    } else if (f?.t === "jobs" && Array.isArray(f.jobs)) jobs.set(f.jobs);
    else if (f?.t === "ev") onEv(f.e);
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
  const transmit = (text: string, pics: ReturnType<typeof foot.images>) => {
    if (text) {
      sent.push(text);
      hi = sent.length;
    }
    userMsg(text, pics);
    cur = null;
    stopped = false;
    setAnswering(true);
    send(pics.length ? { t: "say", text, images: pics } : { t: "say", text });
  };
  const drawQueue = () => {
    qbox.replaceChildren(
      ...queue.map((m) => {
        const row = el("div", undefined, "q");
        const now = el("button", "Gửi ngay", "now");
        const del = el("button", "✕", "del");
        now.type = del.type = "button";
        now.title = "Gửi vào cuộc trò chuyện ngay, không chờ lượt";
        del.title = "Bỏ tin này";
        now.onclick = () => {
          if (locked || ws.readyState !== OPEN || !queue.includes(m)) return;
          queue.splice(queue.indexOf(m), 1);
          drawQueue();
          transmit(m.text, m.pics);
        };
        del.onclick = () => {
          queue.splice(queue.indexOf(m), 1);
          drawQueue();
        };
        row.append(el("span", m.text || `\u{1F5BC} ${m.pics.length} ảnh`, "qt"), now, del);
        return row;
      }),
    );
  };
  const submit = () => {
    if (locked || ws.readyState !== OPEN) return;
    const text = input.value.trim();
    const pics = [...foot.images()]; // a copy: clear() empties the footer's own list
    if (!text && !pics.length) return answering ? stop() : undefined;
    input.value = "";
    input.style.height = "auto";
    foot.clear();
    if (!answering) return transmit(text, pics);
    queue.push({ text, pics });
    drawQueue();
    label();
  };
  btn.onclick = submit;
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT)}px`;
  };
  input.addEventListener("input", () => (grow(), label()));
  input.addEventListener("paste", foot.paste);
  const recall = (to: number) => {
    hi = to;
    input.value = sent[hi] ?? "";
    input.setSelectionRange(input.value.length, input.value.length);
    grow();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
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
      // pressed in this box, or outside every chat: then the newest chat answers
      const stray = !(e.target as Element).closest?.(".chat-overlay");
      const mine = box.contains(e.target as Node) || (stray && open[open.length - 1]?.id === opts.sessionId);
      if (answering && mine && !e.isComposing) stop(); // Esc during IME composition only cancels the composition
    } else if (!root.contains(e.target as Node)) e.stopPropagation();
  };
  document.addEventListener("keydown", onDocKey, true);

  const close = () => {
    open.splice(open.findIndex((c) => c.close === close), 1);
    markOpen(open.map((c) => c.id));
    document.removeEventListener("keydown", onDocKey, true);
    ws.onclose = ws.onmessage = null;
    ws.close();
    win.destroy();
    box.remove();
    if (!open.length) (root.remove(), (shared = null));
    opts.onClose();
  };
  x.onclick = close;
  open.push({ id: opts.sessionId, box, close, geo: win.geo });
  markOpen(open.map((c) => c.id));
}
