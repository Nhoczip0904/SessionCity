export type LaunchOpts = { cwd: string; model?: string; subagentModel?: string; prompt?: string };
export type ExploreState = "off" | "on" | "user";

const MODELS: [string, string][] = [["Mặc định", ""], ["Opus", "opus"], ["Sonnet", "sonnet"], ["Haiku", "haiku"], ["Fable", "fable"]];
const SUBS: [string, string][] = [["Không đặt", ""], ["Haiku", "haiku"], ["Sonnet", "sonnet"], ["Opus", "opus"]];
const STATE_TEXT: Record<ExploreState, string> = { off: "Đang tắt", on: "Đang bật", user: "" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** Backdrop + box + ✕. Closing = removing the root. */
function frame(title: string, ...body: HTMLElement[]): HTMLElement {
  const root = el("div", undefined, "dialog");
  const box = el("div", undefined, "box");
  const x = el("button", "✕", "close");
  x.type = "button";
  x.title = "Đóng";
  x.onclick = () => root.remove();
  box.append(x, el("h2", title), ...body);
  root.append(box);
  root.onclick = (e) => {
    if (e.target === root) root.remove();
  };
  return root;
}

function field(label: string, input: HTMLElement): HTMLElement {
  const l = el("label", label);
  l.append(input);
  return l;
}

function select(cls: string, options: [string, string][]): HTMLSelectElement {
  const s = el("select", undefined, cls);
  for (const [label, value] of options) {
    const o = el("option", label);
    o.value = value;
    s.append(o);
  }
  return s;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".dialog").forEach((d) => d.remove());
});

/** Show a dialog; closes any other one; focuses the first field. */
export function showDialog(d: HTMLElement) {
  document.querySelectorAll(".dialog").forEach((o) => o.remove());
  document.body.append(d);
  d.querySelector<HTMLElement>("select, input, textarea")?.focus();
}

export function renderLaunchDialog(folders: string[], onSubmit: (opts: LaunchOpts) => Promise<string | null>): HTMLElement {
  const folder = select("folder", folders.map((f) => [f, f]));
  const path = el("input", undefined, "path");
  path.type = "text";
  path.placeholder = "hoặc nhập đường dẫn thư mục";
  const model = select("model", MODELS);
  const sub = select("sub", SUBS);
  const prompt = el("textarea");
  prompt.maxLength = 4000;
  prompt.rows = 4;
  const msg = el("div", undefined, "msg");
  const go = el("button", "Mở", "go");
  go.type = "button";
  const root = frame("Mở phiên Claude Code", field("Thư mục", folder), field("Thư mục khác", path), field("Model", model), field("Model nhân viên", sub), field("Yêu cầu đầu tiên (tuỳ chọn)", prompt), msg, go);
  go.onclick = async () => {
    if (go.disabled) return;
    const opts: LaunchOpts = { cwd: path.value.trim() || folder.value };
    if (model.value) opts.model = model.value;
    if (sub.value) opts.subagentModel = sub.value;
    if (prompt.value) opts.prompt = prompt.value;
    go.disabled = true;
    msg.textContent = "";
    const err = await onSubmit(opts);
    if (err === null) {
      msg.textContent = "Đã mở terminal";
      setTimeout(() => root.remove(), 1500);
    } else {
      msg.textContent = err;
      go.disabled = false;
    }
  };
  return root;
}

export function renderModelRules(state: ExploreState, onToggle: (enabled: boolean) => Promise<ExploreState | string>): HTMLElement {
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = state === "on";
  cb.disabled = state === "user";
  const msg = el("div", state === "user" ? "Bạn đã có Explore.md riêng — BackendCity không sửa file này" : STATE_TEXT[state], "msg");
  cb.onchange = async () => {
    const want = cb.checked;
    cb.disabled = true;
    const r = await onToggle(want);
    if (r === "on" || r === "off" || r === "user") {
      cb.checked = r === "on";
      cb.disabled = r === "user";
      msg.textContent = r === "user" ? "Bạn đã có Explore.md riêng — BackendCity không sửa file này" : STATE_TEXT[r];
    } else {
      cb.checked = !want;
      cb.disabled = false;
      msg.textContent = r;
    }
  };
  const label = el("label", "Explore dùng Haiku", "check");
  label.prepend(cb);
  return frame("Quy tắc model", label, el("div", "Áp dụng cho phiên mở sau khi bật", "note"), msg);
}

/** Open the rules dialog: "Đang tải…" first, then the fetched state (or the error). */
export async function showRules(load: () => Promise<ExploreState | string>, onToggle: (enabled: boolean) => Promise<ExploreState | string>) {
  const msg = el("div", "Đang tải…", "msg");
  const shell = frame("Quy tắc model", msg);
  showDialog(shell);
  const r = await load();
  if (!shell.isConnected) return; // closed while loading
  if (r === "on" || r === "off" || r === "user") {
    const d = renderModelRules(r, onToggle);
    shell.replaceWith(d);
    d.querySelector<HTMLElement>("input")?.focus();
  } else msg.textContent = r;
}
