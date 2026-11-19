// Floating chat windows: drag by the title bar, resize from any edge or corner, minimize to a bar docked at the page bottom (flies back up when restored).
export interface Geo { x: number; y: number; w: number; h: number; min: boolean }

const PULL = 12; // px within which a window is drawn flush to another
const MIN_W = 300, MIN_H = 240, BAR_H = 46, TOP = 34, SIDE_W = 190;
const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
let zTop = 20;

const between = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** Keeps the window on the page, under the HUD, and no smaller than the minimum. */
export function clampGeo(g: Geo, vw: number, vh: number): Geo {
  const free = vw > 700 ? vw - SIDE_W : vw; // the session menu (hidden on a narrow page) is not to be covered
  const w = Math.min(Math.max(g.w, MIN_W), free);
  const h = Math.min(Math.max(g.h, MIN_H), vh - TOP);
  const eh = g.min ? BAR_H : h;
  return { w, h, min: g.min, x: between(g.x, 0, free - w), y: between(g.y, TOP, vh - eh) };
}

/** Draws a moved window flush against the nearest edges of the others (edges touching, or lined up); past PULL it overlaps freely. */
export function snapGeo(g: Geo, others: Geo[]): Geo {
  const hOf = (o: Geo) => (o.min ? BAR_H : o.h);
  let { x, y } = g;
  let bx = PULL + 1, by = PULL + 1;
  const mh = hOf(g);
  const pick = (d: number, best: number) => (Math.abs(d) < best ? Math.abs(d) : best);
  for (const o of others) {
    const oh = hOf(o);
    if (g.y < o.y + oh + PULL && g.y + mh > o.y - PULL) // beside it (or nearly): pull sideways
      for (const nx of [o.x - g.w, o.x + o.w, o.x, o.x + o.w - g.w]) if (pick(nx - g.x, bx) < bx) ((bx = Math.abs(nx - g.x)), (x = nx));
    if (g.x < o.x + o.w + PULL && g.x + g.w > o.x - PULL) // above/below it: pull vertically
      for (const ny of [o.y - mh, o.y + oh, o.y, o.y + oh - mh]) if (pick(ny - g.y, by) < by) ((by = Math.abs(ny - g.y)), (y = ny));
  }
  return { ...g, x, y };
}

/** The n-th window: stacked leftwards from the session menu. */
export function defaultGeo(index: number, vw: number, vh: number): Geo {
  const w = Math.min(480, vw);
  return clampGeo({ x: Math.max(16 * index, vw - SIDE_W - (index + 1) * (w + 12)), y: TOP + 12, w, h: vh - TOP - 24, min: false }, vw, vh);
}

export function loadGeo(id: string): Geo | null {
  try {
    const g = JSON.parse(localStorage.getItem(`chat-win:${id}`) ?? "null");
    return g && [g.x, g.y, g.w, g.h].every(Number.isFinite) && typeof g.min === "boolean" ? { x: g.x, y: g.y, w: g.w, h: g.h, min: g.min } : null;
  } catch {
    return null;
  }
}

export function saveGeo(id: string, g: Geo): void {
  try {
    localStorage.setItem(`chat-win:${id}`, JSON.stringify(g));
  } catch { /* private mode or full: the window just opens at the default spot next time */ }
}

export function floatable(box: HTMLElement, bar: HTMLElement, start: Geo, save: (g: Geo) => void): { geo(): Geo; destroy(): void } {
  let want = start; // where the user put it: a narrow browser only squeezes what is drawn, a wide one gives it back
  let g = clampGeo(want, innerWidth, innerHeight);
  const apply = () => {
    g = clampGeo(want, innerWidth, innerHeight);
    box.style.left = `${g.x}px`;
    box.style.top = `${g.min ? Math.max(TOP, innerHeight - BAR_H) : g.y}px`; // g.y keeps the spot to fly back to
    box.style.width = `${g.w}px`;
    box.style.height = `${g.h}px`;
    box.classList.toggle("min", g.min);
  };
  const others = (): Geo[] =>
    [...document.querySelectorAll<HTMLElement>(".chat-box")].filter((b) => b !== box).map((b) => ({ x: parseFloat(b.style.left), y: parseFloat(b.style.top), w: parseFloat(b.style.width), h: parseFloat(b.style.height), min: b.classList.contains("min") }));
  const raise = () => void (box.style.zIndex = String(++zTop));
  let drag: { fromX: number; fromY: number; from: Geo; dir: string } | null = null;
  const begin = (e: MouseEvent, dir: string) => {
    drag = { fromX: e.clientX, fromY: e.clientY, from: g, dir };
    box.classList.add("drag"); // no flying while the pointer holds it
    e.preventDefault();
  };
  const move = (e: MouseEvent) => {
    if (!drag) return;
    const { from: f, dir } = drag;
    const dx = e.clientX - drag.fromX, dy = e.clientY - drag.fromY;
    if (dir === "move") return void ((want = snapGeo({ ...f, x: f.x + dx, y: f.min ? f.y : f.y + dy }, others())), apply());
    let { x, y, w, h } = f;
    if (dir.includes("e")) w = Math.max(MIN_W, f.w + dx);
    if (dir.includes("s")) h = Math.max(MIN_H, f.h + dy);
    if (dir.includes("w")) (w = Math.max(MIN_W, f.w - dx), (x = f.x + f.w - w));
    if (dir.includes("n")) (h = Math.max(MIN_H, f.h - dy), (y = f.y + f.h - h));
    want = { x, y, w, h, min: false };
    apply();
  };
  const up = () => {
    if (!drag) return;
    drag = null;
    box.classList.remove("drag");
    want = g; // what was let go of, kept on the page
    save(want);
  };
  const toggle = () => {
    want = { ...g, min: !g.min };
    apply();
    save(want);
  };

  const minb = document.createElement("button");
  minb.type = "button";
  minb.className = "minb";
  minb.title = "Thu nhỏ";
  minb.textContent = "–";
  minb.onclick = toggle;
  bar.querySelector(".close")?.before(minb);
  for (const d of DIRS) {
    const h = document.createElement("div");
    h.className = "rz";
    h.dataset.d = d;
    h.addEventListener("pointerdown", (e) => begin(e as MouseEvent, d));
    box.append(h);
  }
  bar.addEventListener("pointerdown", (e) => {
    if (!(e.target as Element).closest("button, input")) begin(e as MouseEvent, "move");
  });
  bar.addEventListener("dblclick", (e) => {
    if (!(e.target as Element).closest("button, input")) toggle();
  });
  box.addEventListener("pointerdown", raise);
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("resize", apply);
  apply();
  raise();
  return {
    geo: () => want,
    destroy() {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("resize", apply);
    },
  };
}
