// Glass look of the chat windows: how much of the city shows blurred behind them. One setting for all windows, kept in localStorage.
const KEY = "city.chatBlur";
export const BLUR_DEFAULT = 14, BLUR_MAX = 24;
const sliders = new Set<HTMLInputElement>();

export function loadBlur(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return localStorage.getItem(KEY) === null || !Number.isFinite(n) ? BLUR_DEFAULT : Math.min(BLUR_MAX, Math.max(0, Math.round(n)));
  } catch {
    return BLUR_DEFAULT;
  }
}

/** Sets the page-wide blur (px) the chat boxes read from css, and remembers it. */
export function applyBlur(px: number): void {
  document.documentElement.style.setProperty("--chat-blur", `${px}px`);
  try { localStorage.setItem(KEY, String(px)); } catch { /* private mode: back to the default after a reload */ }
}

/** A range input for the chat title bar; every slider on the page follows the others. */
export function blurSlider(): HTMLInputElement {
  const s = document.createElement("input");
  s.type = "range";
  s.className = "blur-range";
  s.min = "0";
  s.max = String(BLUR_MAX);
  s.value = String(loadBlur());
  applyBlur(Number(s.value)); // a chat opening after a reload picks the saved blur up
  s.title = "Độ mờ nền";
  s.addEventListener("input", () => {
    applyBlur(Number(s.value));
    for (const o of sliders) if (!o.isConnected) sliders.delete(o); else if (o !== s) o.value = s.value;
  });
  sliders.add(s);
  return s;
}
