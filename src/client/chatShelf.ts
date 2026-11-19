// A small bookshelf in each chat box: one spine per instruction file loaded into that session (CLAUDE.md and friends), on the right edge of the box. Click a spine to show the file in Explorer; the arrow slides the shelf in and out.
import type { Shelf } from "../shared/types.js";

const SPINE = { user: "#7a5a8a", project: "#8b4a3c", local: "#3f6f5a" };

export function shelfStrip(sessionId: string, fetchFn: typeof fetch = globalThis.fetch): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "chat-shelf";
  strip.hidden = true;
  const base = `/api/session/${encodeURIComponent(sessionId)}/shelf`;
  void fetchFn(base)
    .then((r) => (r.ok ? (r.json() as Promise<Shelf>) : null))
    .then((s) => {
      if (!s?.files.length) return;
      const row = document.createElement("div");
      row.className = "books";
      const name = document.createElement("div"); // the file name of the book under the pointer
      name.className = "name";
      s.files.forEach((f, i) => {
        const parts = f.path.split(/[\\/]/);
        const book = document.createElement("button");
        book.type = "button";
        book.className = "book";
        book.style.background = SPINE[f.scope];
        book.style.height = `${58 + ((i * 7) % 5) * 4}px`; // uneven heights, like real books
        book.style.width = `${14 + Math.round(Math.min(f.size, 8000) / 8000 * 12)}px`; // bigger file, thicker book
        book.title = `${f.path}\nBấm để hiện file trong Explorer`;
        const label = f.scope === "local" ? "local" : parts.at(-1) === "CLAUDE.md" ? parts.at(-2) ?? "CLAUDE.md" : parts.at(-1)!;
        book.onmouseenter = () => (name.textContent = label);
        book.onmouseleave = () => (name.textContent = "");
        book.onclick = () => void fetchFn(`${base}/${f.id}/open`, { method: "POST" });
        row.append(book);
      });
      const plank = document.createElement("div");
      plank.className = "plank";
      const shelf = document.createElement("div");
      shelf.className = "case";
      shelf.append(row, plank, name);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab";
      tab.textContent = "▾";
      tab.title = "Thu gọn / mở ra";
      tab.onclick = () => (tab.textContent = strip.classList.toggle("in") ? "▸" : "▾");
      strip.append(tab, shelf);
      strip.hidden = false;
    })
    .catch(() => {}); // no shelf is not worth a message in the chat
  return strip;
}
