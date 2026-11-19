// A strip in each chat box showing the subagents still working for that session, so a long run is not mistaken for a finished chat.
// Each one paces left and right along the strip; when it finishes it runs off the right edge.
import type { Employee } from "../shared/types.js";
import { walkStrip } from "./walkCycle.js";

type Face = (id: string) => string | null;
const strips = new Map<HTMLElement, string>(); // strip -> its session id
const chips = new WeakMap<HTMLElement, Map<string, HTMLElement>>(); // strip -> its walking chips by employee id
let last: Employee[] = [];
let faceOf: Face = () => null;
let walkers = 0;
const EMOTES = ["💭", "🔍", "☕", "♪", "💡", "⚙️", "📖", "🧪", "🔧", "🤔", "✍️", "🐛"]; // a puff above the head now and then, a new one each time
const TRICKS = ["hop", "spin", "dance", "flip", "shake", "peek"]; // each is a class + keyframes of the same name in index.html
const QUIPS = ["Đang làm đây!", "Đừng chọc!", "Hmm…", "Sắp xong rồi", "Đang đọc code", "Bug đâu rồi?", "Cà phê đâu?"];
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Stops pacing for a moment and does something with a prop; each name is a class + keyframes in index.html.
const ACTS: Record<string, { prop: string; ms: number }> = {
  write: { prop: "📝", ms: 3500 },
  think: { prop: "🤔", ms: 3000 },
  pushup: { prop: "💪", ms: 3500 },
  coffee: { prop: "☕", ms: 2500 },
};
const clearAct = (chip: HTMLElement) => {
  chip.classList.remove("busy", ...Object.keys(ACTS));
  chip.querySelector(".prop")?.remove();
};
const act = (chip: HTMLElement, name = pick(Object.keys(ACTS))) => {
  if (chip.classList.contains("busy")) return;
  const prop = document.createElement("span");
  prop.className = "prop";
  prop.textContent = ACTS[name]!.prop;
  prop.setAttribute("aria-hidden", "true");
  chip.classList.add("busy", name);
  chip.append(prop);
  setTimeout(() => {
    if (prop.isConnected) clearAct(chip);
  }, ACTS[name]!.ms);
};

/** A small show now and then, so a long run looks alive: it stops and does something, or a quick trick. */
const idle = (chip: HTMLElement) => {
  setTimeout(() => {
    if (!chip.isConnected || chip.classList.contains("done") || chip.classList.contains("leaving")) return;
    if (!calm()) (Math.random() < 0.7 ? act : trick)(chip);
    idle(chip);
  }, 3000 + Math.random() * 6000);
};
const trick = (chip: HTMLElement, name = pick(TRICKS)) => {
  for (const x of TRICKS) chip.classList.remove(x);
  void chip.offsetWidth;
  chip.classList.add(name);
};
/** Confetti burst when it finishes. */
const confetti = (chip: HTMLElement) => {
  for (let i = 0; i < 9; i++) {
    const c = document.createElement("span");
    c.className = "confetti";
    c.textContent = pick(["🎉", "✨", "⭐", "🎊"]);
    c.style.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 70)}px`);
    c.style.setProperty("--dy", `${-14 - Math.round(Math.random() * 18)}px`);
    c.style.animationDelay = `${i * 40}ms`;
    chip.append(c);
    setTimeout(() => c.remove(), 1400);
  }
};

const addFace = (chip: HTMLElement, face: string) => {
  const img = document.createElement("img");
  img.src = face;
  img.alt = "";
  const still = new Image(); // once it loads, swap in the walk cycle (4 frames, 32px each; the CSS steps through them)
  still.onload = () => {
    const strip = walkStrip(still, 32 / still.naturalWidth);
    if (strip && img.isConnected) { img.src = strip; img.classList.add("sheet"); }
  };
  still.src = face;
  chip.prepend(img);
  chip.classList.add("face"); // no face = keep the text, nothing else identifies it
};

const make = (e: Employee): HTMLElement => {
  const chip = document.createElement("span");
  chip.className = "staff";
  const n = walkers++; // own pace and starting spot per walker, so a crowd does not march in step
  const dur = 6 + (n % 4) * 1.5;
  chip.style.setProperty("--d", `${dur}s`);
  chip.style.setProperty("--delay", `${-((n * 1.7) % dur)}s`);
  const face = faceOf(e.id);
  if (face) addFace(chip, face);
  const em = document.createElement("span");
  em.className = "emote";
  em.textContent = EMOTES[n % EMOTES.length]!;
  em.setAttribute("aria-hidden", "true");
  chip.append(em);
  em.addEventListener("animationiteration", () => (em.textContent = pick(EMOTES))); // a new thought every cycle
  chip.addEventListener("click", () => { // poke it: a trick and a grumble
    trick(chip);
    const old = chip.querySelector(".say");
    if (old || chip.classList.contains("done")) return;
    const say = document.createElement("span");
    say.className = "say";
    say.textContent = pick(QUIPS);
    chip.append(say);
    setTimeout(() => say.remove(), 1500);
  });
  chip.addEventListener("animationend", (e) => { // trick over: its class is the keyframes name, or the frames' (f2/f3/f4) on a sprite sheet
    if (/^f[234]$/.test(e.animationName)) chip.classList.remove(...TRICKS);
    else chip.classList.remove(e.animationName);
  });
  if (!calm()) chip.classList.add("arrive"); // drops in from above
  idle(chip);
  const t = document.createElement("span");
  t.className = "name";
  t.textContent = `${e.type}: ${e.description}`;
  chip.append(t);
  return chip;
};

/** Freeze the chip where it stands, let it announce it is done, then run off past the right edge. */
const leave = (strip: HTMLElement, chip: HTMLElement) => {
  clearAct(chip);
  chip.style.left = `${chip.offsetLeft}px`;
  chip.style.animation = "none";
  chip.style.transform = "none";
  chip.classList.add("done");
  if (!calm()) confetti(chip);
  const say = document.createElement("span");
  say.className = "say";
  say.textContent = "Xong rồi! ✓";
  chip.append(say);
  let gone = false;
  const clear = () => {
    if (gone) return;
    gone = true;
    chip.remove();
    strip.hidden = !strip.childElementCount;
  };
  setTimeout(() => {
    say.remove();
    void chip.offsetWidth; // commit the frozen spot so the run starts from it
    chip.classList.remove("done");
    chip.classList.add("leaving");
    chip.style.left = "100%";
    chip.addEventListener("transitionend", clear);
    setTimeout(clear, 1200); // no transition event (hidden tab, reduced motion): still clear it
  }, 1200);
};

const draw = (strip: HTMLElement, sessionId: string) => {
  const mine = new Map(last.filter((e) => e.sessionId === sessionId && e.status === "working").map((e) => [e.id, e]));
  let have = chips.get(strip);
  if (!have) chips.set(strip, (have = new Map()));
  for (const [id, chip] of have) {
    if (mine.has(id)) continue;
    have.delete(id);
    leave(strip, chip);
  }
  for (const [id, e] of mine) {
    const chip = have.get(id);
    if (!chip) {
      const fresh = make(e);
      have.set(id, fresh);
      strip.append(fresh);
    } else if (!chip.querySelector("img")) {
      const face = faceOf(id);
      if (face) addFace(chip, face); // its face arrived after it started
    }
  }
  strip.hidden = !strip.childElementCount;
};

export function staffStrip(sessionId: string): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "chat-staff";
  strips.set(strip, sessionId);
  draw(strip, sessionId);
  return strip;
}

/** Redraw every strip still on the page (called on each live update). */
export function refreshStaff(employees: Employee[], face: Face): void {
  last = employees;
  faceOf = face;
  for (const [strip, id] of strips) {
    if (!strip.isConnected) strips.delete(strip);
    else draw(strip, id);
  }
}
