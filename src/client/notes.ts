// Sticky notes pinned over the city (test accounts, reminders). The server keeps them in a JSON file; localStorage is the fallback cache.
import { NOTE_COLORS, NOTE_DRAG, sanitizeNotes, type Note } from "../shared/notes.js";
export { NOTE_COLORS, type Note };
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): unknown };
/** The server copy: `load` → null when it cannot be reached; `save` is fire-and-forget. */
export interface Remote { load(): Promise<Note[] | null>; save(notes: Note[]): void }

export const NOTES_KEY = "backendcity.notes";
const W = 220, TOP = 32; // note width; the HUD bar above is 32px
const POLL_MS = 5000; // how often the server file is re-read, so hand edits show up

export function readNotes(s: Store): Note[] {
  try {
    return sanitizeNotes(JSON.parse(s.getItem(NOTES_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function mountNotes(btn: HTMLElement, host: HTMLElement, s: Store, remote?: Remote): void {
  let notes = readNotes(s);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsent = false; // a local edit the server has not got yet
  const roots = new Map<Note, HTMLElement>(); // pinned notes currently on the screen
  const listBtn = document.createElement("button");
  listBtn.type = "button";
  listBtn.textContent = "☰";
  listBtn.title = "Danh sách ghi chú (ghim / bỏ ghim)";
  const list = document.createElement("div");
  list.className = "note-list";
  list.hidden = true;
  btn.after(listBtn);
  host.append(list);
  const save = () => {
    try {
      s.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      // storage full or blocked: the notes still work until the page reloads
    }
    if (!remote) return;
    clearTimeout(timer);
    unsent = true;
    timer = setTimeout(() => {
      unsent = false;
      remote.save(notes);
    }, 400); // typing sends one request, not one per key
  };
  const label = () => (btn.textContent = notes.length ? `📌 Ghi chú (${notes.length})` : "📌 Ghi chú");
  const fillList = () => {
    const ul = document.createElement("ul");
    for (const n of notes) {
      const li = document.createElement("li");
      const pin = pinBtn(n);
      const t = document.createElement("span");
      t.textContent = n.text.trim().split("\n")[0].slice(0, 40) || "(trống)";
      const x = document.createElement("button");
      x.type = "button";
      x.className = "note-del";
      x.textContent = "×";
      x.title = "Xóa ghi chú";
      x.onclick = () => remove(n);
      li.append(pin, t, x);
      ul.append(li);
    }
    list.replaceChildren(ul);
  };
  const setPinned = (n: Note, v: boolean) => {
    n.pinned = v;
    if (v) draw(n);
    else roots.get(n)?.remove(), roots.delete(n);
    save();
    fillList();
  };
  const pinBtn = (n: Note) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "note-pin";
    b.textContent = n.pinned ? "📌" : "📍";
    b.title = n.pinned ? "Bỏ ghim (cất khỏi màn hình, vẫn còn trong danh sách)" : "Ghim lên màn hình";
    b.onclick = () => setPinned(n, !n.pinned);
    return b;
  };
  const remove = (n: Note) => {
    if (n.text.trim() && !confirm("Xóa ghi chú này?")) return;
    roots.get(n)?.remove();
    roots.delete(n);
    notes = notes.filter((x) => x !== n);
    save();
    label();
    fillList();
  };
  const clamp = (n: Note) => {
    n.x = Math.min(Math.max(0, n.x), Math.max(0, innerWidth - W));
    n.y = Math.min(Math.max(TOP, n.y), Math.max(TOP, innerHeight - 48));
  };

  const draw = (n: Note) => {
    clamp(n);
    const root = document.createElement("div");
    roots.set(n, root);
    root.className = "sticky"; // not "note": that class is the small grey caption in dialogs
    root.style.background = n.color;
    root.style.left = `${n.x}px`;
    root.style.top = `${n.y}px`;
    root.style.setProperty("--tilt", `${([...n.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) - 2}deg`);
    const bar = document.createElement("div");
    bar.className = "note-bar";
    bar.title = "Kéo để di chuyển";
    const grab = document.createElement("div");
    grab.className = "note-grab";
    grab.textContent = "✉";
    grab.draggable = true; // the textarea fills the note and takes the press as a text selection, so the envelope is the handle that always drags
    root.draggable = true; // the whole note can be thrown into a chat; the top strip still moves it
    grab.title = "Kéo cả tờ ghi chú vào khung chat để gửi nội dung";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "note-del";
    del.textContent = "×";
    del.title = "Xóa ghi chú";
    const text = document.createElement("textarea");
    text.className = "note-text";
    text.value = n.text;
    text.placeholder = "Tài khoản test, ghi chú…";
    text.spellcheck = false;
    root.append(bar, grab, pinBtn(n), del, text);
    host.append(root);

    root.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", n.text);
      e.dataTransfer?.setData(NOTE_DRAG, "1"); // lets the chat box take the drop anywhere, not only over its textarea
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer?.setDragImage?.(root, 20, 10);
    });
    text.oninput = () => {
      n.text = text.value;
      save();
      fillList();
    };
    del.onclick = () => remove(n);
    // the touched note goes on top by z-index: moving the node in the DOM here would cancel the native drag into a chat
    root.addEventListener("pointerdown", () => {
      roots.forEach((r) => (r.style.zIndex = ""));
      root.style.zIndex = "22";
    });
    bar.addEventListener("pointerdown", (e) => {
      const dx = e.clientX - n.x, dy = e.clientY - n.y;
      root.draggable = false; // else the browser starts a native drag and the pointer events stop mid-move
      // on the document, not the strip: a fast pointer outruns the note and would leave it behind
      const move = (m: MouseEvent) => {
        n.x = m.clientX - dx;
        n.y = m.clientY - dy;
        clamp(n);
        root.style.left = `${n.x}px`;
        root.style.top = `${n.y}px`;
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        root.draggable = true;
        save();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
    return text;
  };

  const show = () => {
    roots.forEach((r) => r.remove());
    roots.clear();
    notes.filter((n) => n.pinned).forEach(draw);
    label();
    fillList();
  };
  const adopt = (r: Note[]) => {
    notes = sanitizeNotes(r); // hand-written JSON may leave fields out
    show();
    try {
      s.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      // cache only
    }
  };
  show();
  listBtn.onclick = () => {
    list.hidden = !list.hidden;
    const b = btn.getBoundingClientRect();
    list.style.top = `${b.bottom + 4}px`;
    list.style.right = `${Math.max(8, innerWidth - b.right)}px`;
  };
  // The server file wins; notes that only exist in this browser are sent up once (migration).
  void remote?.load().then((r) => {
    if (!r) return;
    if (!r.length && notes.length) return remote.save(notes);
    adopt(r);
  });
  if (remote)
    setInterval(() => {
      // never under a note being typed in, nor over an edit still waiting to be sent
      if (unsent || host.contains(document.activeElement) && document.activeElement?.closest(".sticky")) return;
      void remote.load().then((r) => {
        // shortcut: an empty answer is ignored (could be a file mid-write); clearing by hand needs a reload
        if (r?.length && JSON.stringify(sanitizeNotes(r)) !== JSON.stringify(sanitizeNotes(notes))) adopt(r);
      });
    }, POLL_MS);
  btn.onclick = () => {
    const k = notes.length % 6;
    const n: Note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), x: innerWidth - W - 24 - k * 28, y: 48 + k * 28, color: NOTE_COLORS[notes.length % NOTE_COLORS.length], text: "", pinned: true };
    notes.push(n);
    const text = draw(n);
    save();
    label();
    fillList();
    text.focus();
  };
}
