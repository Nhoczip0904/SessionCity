import type { SessionMeta } from "../shared/types.js";
import { el } from "./launcher.js";

export interface Picture { media_type: string; data: string }

const MODELS: [string, string][] = [["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"], ["claude-fable-5-2", "Fable 5.2"]];
const MODES: [string, string][] = [["default", "Hỏi trước"], ["acceptEdits", "Tự sửa file"], ["plan", "Lập kế hoạch"], ["auto", "Tự động"]];
const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_PICS = 4;
const MAX_BYTES = 3.5 * 1024 * 1024; // ≈ 4.7M chars of base64, under the server's 5M
const WINDOW = 200_000; // shortcut: the transcript does not say if the session has the 1M window; one that holds more than this is shown against 1M
const WIDE = 1_000_000;

const opt = (text: string, value: string) => {
  const o = document.createElement("option");
  o.textContent = text;
  o.value = value;
  return o;
};
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
const base = (p: string) => p.split(/[\\/]/).pop() || p;

/** The parts of a chat around its input that Claude's own app has: attach images, pick model and permissions, context meter, files changed. */
export function chatFooter(o: { send(m: object): void; meta(): Promise<SessionMeta | null>; note(text: string): void }) {
  const pics: (Picture & { url: string })[] = [];

  const chips = el("div", undefined, "chat-chips chat-extra");
  chips.hidden = true;
  const draw = () => {
    chips.hidden = !pics.length;
    chips.replaceChildren(
      ...pics.map((p, i) => {
        const chip = el("span", undefined, "chip");
        const img = el("img");
        img.src = p.url;
        img.alt = "";
        const x = el("button", "✕");
        x.type = "button";
        x.title = "Bỏ ảnh";
        x.onclick = () => {
          pics.splice(i, 1);
          draw();
        };
        chip.append(img, x);
        return chip;
      }),
    );
  };
  const take = (files: File[]) => {
    for (const f of files) {
      if (!TYPES.includes(f.type)) continue;
      if (pics.length >= MAX_PICS) return o.note(`Tối đa ${MAX_PICS} ảnh`);
      if (f.size > MAX_BYTES) {
        o.note(`Ảnh ${f.name || ""} quá lớn (tối đa 3,5 MB)`);
        continue;
      }
      const r = new FileReader();
      r.onload = () => {
        const url = String(r.result);
        if (pics.length < MAX_PICS) pics.push({ media_type: f.type, data: url.slice(url.indexOf(",") + 1), url });
        draw();
      };
      r.readAsDataURL(f);
    }
  };
  const file = el("input");
  file.type = "file";
  file.accept = TYPES.join(",");
  file.multiple = true;
  file.hidden = true;
  file.onchange = () => {
    take(Array.from(file.files ?? []));
    file.value = "";
  };
  const plus = el("button", "+", "chat-plus chat-extra");
  plus.type = "button";
  plus.title = "Đính kèm ảnh";
  plus.onclick = () => file.click();

  const pick = (opts: [string, string][], value: string, on: (v: string) => void) => {
    const s = el("select", undefined, "chat-pick");
    for (const [v, t] of opts) s.append(opt(t, v));
    s.value = value;
    s.onchange = () => on(s.value);
    return s;
  };
  const model = pick(MODELS, "", (m) => o.send({ t: "model", model: m }));
  const mode = pick(MODES, "default", (m) => o.send({ t: "mode", mode: m }));
  model.hidden = true; // until the transcript says which model it runs on
  const fill = el("i");
  const meter = el("span", undefined, "chat-meter");
  meter.append(el("span", undefined, "track"), el("small"));
  meter.firstElementChild!.append(fill);
  meter.hidden = true;
  const bar = el("div", undefined, "chat-foot chat-extra");
  bar.append(model, mode, meter);

  const panel = el("details", undefined, "chat-meta chat-extra");
  panel.hidden = true;

  const refresh = () =>
    void o.meta().then((m) => {
      if (!m) return;
      if (m.model) {
        if (![...model.options].some((x) => x.value === m.model)) model.append(opt(m.model.replace(/^claude-/, ""), m.model));
        model.value = m.model;
        model.hidden = false;
      }
      meter.hidden = !m.used;
      const win = m.used > WINDOW ? WIDE : WINDOW;
      const pct = Math.min(100, Math.round((m.used / win) * 100));
      fill.style.width = `${pct}%`;
      meter.classList.toggle("hot", pct >= 80);
      meter.lastElementChild!.textContent = `${pct}% · ${k(m.used)}/${k(win)}`;
      meter.title = "Ngữ cảnh đã dùng";

      const files = m.changes.flatMap((r) => r.files.map((f) => ({ repo: r.repo, ...f })));
      panel.hidden = !files.length && !m.outputs.length;
      const sum = el("summary", `Thay đổi ${files.length} · Kết quả ${m.outputs.length}`);
      panel.replaceChildren(sum);
      if (files.length) {
        const ul = el("ul", undefined, "chg");
        for (const f of files.slice(0, 30)) {
          const li = el("li");
          li.append(el("b", f.status, `st st-${f.status === "?" ? "u" : f.status}`), el("span", f.path), el("small", f.add || f.del ? `+${f.add} −${f.del}` : ""));
          ul.append(li);
        }
        panel.append(el("h4", "Thay đổi chưa commit"), ul);
      }
      if (m.outputs.length) {
        const ul = el("ul", undefined, "out");
        for (const p of m.outputs) {
          const li = el("li", base(p));
          li.title = p;
          ul.append(li);
        }
        panel.append(el("h4", "Kết quả đầu ra"), ul);
      }
    });

  return {
    chips,
    plus,
    file,
    bar,
    panel,
    refresh,
    /** The permission mode the server says is in force. */
    setMode: (m: string) => {
      if ([...mode.options].some((x) => x.value === m)) mode.value = m;
    },
    /** Images in the input box (also from a paste or a drop); `paste` is the handler for the textarea. */
    images: (): Picture[] => pics.map(({ media_type, data }) => ({ media_type, data })),
    clear: () => {
      pics.length = 0;
      draw();
    },
    paste: (e: ClipboardEvent) => {
      const fs = Array.from(e.clipboardData?.files ?? []).filter((f) => TYPES.includes(f.type));
      if (!fs.length) return;
      e.preventDefault();
      take(fs);
    },
  };
}
