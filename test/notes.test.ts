// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountNotes, NOTES_KEY, readNotes } from "../src/client/notes.js";
import { NOTE_DRAG, sanitizeNotes, type Note } from "../src/shared/notes.js";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("sticky notes", () => {
  let btn: HTMLButtonElement;
  beforeEach(() => {
    document.body.innerHTML = '<button id="b"></button>';
    btn = document.getElementById("b") as HTMLButtonElement;
  });

  it("adds a note, saves what is typed, and brings it back after a reload", () => {
    const s = mem();
    mountNotes(btn, document.body, s);
    btn.click();
    const ta = document.querySelector<HTMLTextAreaElement>(".note-text")!;
    ta.value = "admin@test / Abc123";
    ta.dispatchEvent(new Event("input"));
    expect(btn.textContent).toContain("(1)");

    document.body.innerHTML = '<button id="b"></button>';
    mountNotes(document.getElementById("b")!, document.body, s);
    expect(document.querySelector<HTMLTextAreaElement>(".note-text")!.value).toBe("admin@test / Abc123");
  });

  it("deleting asks first when the note has text, and not when it is empty", () => {
    const s = mem();
    mountNotes(btn, document.body, s);
    btn.click();
    document.querySelector<HTMLButtonElement>(".note-del")!.click(); // empty: no prompt
    expect(document.querySelectorAll(".sticky")).toHaveLength(0);

    btn.click();
    const ta = document.querySelector<HTMLTextAreaElement>(".note-text")!;
    ta.value = "keep";
    ta.dispatchEvent(new Event("input"));
    const ask = vi.fn().mockReturnValueOnce(false);
    vi.stubGlobal("confirm", ask);
    document.querySelector<HTMLButtonElement>(".note-del")!.click();
    expect(ask).toHaveBeenCalled();
    expect(document.querySelectorAll(".sticky")).toHaveLength(1);
    ask.mockReturnValueOnce(true);
    document.querySelector<HTMLButtonElement>(".note-del")!.click();
    expect(readNotes(s)).toEqual([]);
  });

  it("dragging the top strip moves the note and saves its place", () => {
    const s = mem();
    mountNotes(btn, document.body, s);
    btn.click();
    const bar = document.querySelector<HTMLElement>(".note-bar")!;
    const { x, y } = readNotes(s)[0];
    bar.dispatchEvent(new MouseEvent("pointerdown", { clientX: x + 5, clientY: y + 5, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: x - 95, clientY: y + 55 }));
    document.dispatchEvent(new MouseEvent("pointerup"));
    expect(readNotes(s)[0]).toMatchObject({ x: x - 100, y: y + 50 });
  });

  it("a fast drag keeps following the pointer after it leaves the strip, and the note is not natively draggable meanwhile", () => {
    const s = mem();
    mountNotes(btn, document.body, s);
    btn.click();
    const bar = document.querySelector<HTMLElement>(".note-bar")!, root = document.querySelector<HTMLElement>(".sticky")!;
    const { x, y } = readNotes(s)[0];
    bar.dispatchEvent(new MouseEvent("pointerdown", { clientX: x + 5, clientY: y + 5, bubbles: true }));
    expect(root.draggable).toBe(false);
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: x - 195, clientY: y + 105 })); // the pointer outran the strip
    document.dispatchEvent(new MouseEvent("pointerup"));
    expect(root.draggable).toBe(true);
    expect(readNotes(s)[0]).toMatchObject({ x: x - 200, y: y + 100 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 0 }));
    expect(readNotes(s)[0]).toMatchObject({ x: x - 200, y: y + 100 }); // released: no longer follows
  });

  it("touching a note raises it without moving it in the DOM (that would cancel a native drag into a chat)", () => {
    const s = mem();
    mountNotes(btn, document.body, s);
    btn.click();
    btn.click();
    const [a, b] = [...document.querySelectorAll<HTMLElement>(".sticky")];
    const parent = a.parentElement, before = [...parent!.children];
    a.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect([...parent!.children]).toEqual(before);
    expect(a.style.zIndex).toBe("22");
    b.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(a.style.zIndex).toBe("");
    expect(b.style.zIndex).toBe("22");
  });

  it("ignores junk in storage and unknown colours", () => {
    const s = mem();
    s.setItem(NOTES_KEY, "{not json");
    expect(readNotes(s)).toEqual([]);
    s.setItem(NOTES_KEY, JSON.stringify([{ id: "a", x: 1, y: 2, text: "t", color: "red;background:url(x)" }, { nope: 1 }]));
    expect(readNotes(s)).toEqual([{ id: "a", x: 1, y: 2, text: "t", color: "#fff59d", pinned: true }]);
  });
});

describe("notes: drag handle and server file", () => {
  it("the envelope handle drags the note text as text/plain", () => {
    document.body.innerHTML = '<button id="b"></button>';
    const btn = document.getElementById("b")!;
    mountNotes(btn, document.body, mem());
    btn.click();
    const ta = document.querySelector<HTMLTextAreaElement>(".note-text")!;
    ta.value = "user / pw";
    ta.dispatchEvent(new Event("input"));
    const set = vi.fn();
    const ev = new Event("dragstart", { bubbles: true });
    Object.assign(ev, { dataTransfer: { setData: set } });
    expect((document.querySelector(".sticky") as HTMLElement).draggable).toBe(true);
    document.querySelector(".note-text")!.dispatchEvent(ev); // from anywhere on the note
    expect(set).toHaveBeenCalledWith("text/plain", "user / pw");
    expect(set).toHaveBeenCalledWith(NOTE_DRAG, "1");
  });

  it("server notes replace the local ones; local-only notes are migrated up", async () => {
    const s = mem();
    s.setItem(NOTES_KEY, JSON.stringify([{ id: "l", x: 5, y: 40, text: "local", color: "#fff59d" }]));
    document.body.innerHTML = '<button id="b"></button>';
    const save = vi.fn();
    mountNotes(document.getElementById("b")!, document.body, s, { load: async () => [], save });
    await new Promise((r) => setTimeout(r, 0));
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "l" })]);

    document.body.innerHTML = '<button id="b"></button>';
    mountNotes(document.getElementById("b")!, document.body, s, { load: async () => [{ id: "r", x: 9, y: 50, text: "remote", color: "#ffcc80" }] as Note[], save });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll(".sticky")).toHaveLength(1);
    expect(document.querySelector<HTMLTextAreaElement>(".note-text")!.value).toBe("remote");
  });
});

describe("notes: pinning, list, live reload", () => {
  const mk = (id: string, pinned?: boolean, text = id) => ({ id, x: 10, y: 50, text, color: "#fff59d", ...(pinned === undefined ? {} : { pinned }) });
  const page = () => {
    document.body.innerHTML = '<button id="b"></button>';
    return document.getElementById("b")!;
  };

  it("sanitize: pinned defaults to true; only an explicit false unpins", () => {
    expect(sanitizeNotes([mk("a"), mk("b", false), mk("c", true), { ...mk("d"), pinned: "no" }]).map((n) => n.pinned)).toEqual([true, false, true, true]);
  });

  it("only pinned notes are on the screen; the list shows all and pins/unpins", () => {
    const s = mem();
    s.setItem(NOTES_KEY, JSON.stringify([mk("a", true), mk("b", false, "second")]));
    mountNotes(page(), document.body, s);
    expect(document.querySelectorAll(".sticky")).toHaveLength(1);
    const items = () => document.querySelectorAll<HTMLElement>(".note-list li");
    expect(items()).toHaveLength(2);
    items()[1].querySelector<HTMLElement>(".note-pin")!.click(); // pin b
    expect(document.querySelectorAll(".sticky")).toHaveLength(2);
    expect(readNotes(s).map((n) => n.pinned)).toEqual([true, true]);
    document.querySelector<HTMLElement>(".sticky .note-pin")!.click(); // unpin a from its own note
    expect(document.querySelectorAll(".sticky")).toHaveLength(1);
    expect(readNotes(s)[0].pinned).toBe(false);
    expect(items()).toHaveLength(2); // still listed
  });

  it("hand edits to the server file show up without a reload, but not while typing", async () => {
    vi.useFakeTimers();
    try {
      let server = [mk("a", true, "old")];
      const save = vi.fn();
      mountNotes(page(), document.body, mem(), { load: async () => server as Note[], save });
      await vi.advanceTimersByTimeAsync(0);
      expect(document.querySelector<HTMLTextAreaElement>(".note-text")!.value).toBe("old");
      server = [mk("a", true, "edited by hand"), mk("z", true, "new")];
      await vi.advanceTimersByTimeAsync(6000);
      expect([...document.querySelectorAll<HTMLTextAreaElement>(".note-text")].map((t) => t.value)).toEqual(["edited by hand", "new"]);
      const ta = document.querySelector<HTMLTextAreaElement>(".note-text")!;
      ta.focus();
      server = [mk("a", true, "clobber")];
      await vi.advanceTimersByTimeAsync(6000);
      expect(document.querySelectorAll(".note-text")).toHaveLength(2); // focused: left alone
    } finally {
      vi.useRealTimers();
    }
  });
});
