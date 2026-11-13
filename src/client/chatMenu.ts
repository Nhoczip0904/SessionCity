import type { Session } from "../shared/types.js";
import { el } from "./launcher.js";

/** The sessions beside the chat, grouped by folder (newest group and session first); the open one is marked. */
export function sessionMenu(
  sessions: Session[],
  current: string,
  avatarOf: (id: string) => string | null,
  pick: (id: string) => void,
): HTMLElement {
  const groups = new Map<string, Session[]>();
  for (const s of [...sessions].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))) {
    const g = groups.get(s.cwd);
    if (g) g.push(s);
    else groups.set(s.cwd, [s]); // insertion order = most recently active first
  }
  const root = el("div", undefined, "chat-side");
  for (const list of groups.values()) {
    root.append(el("h4", list[0].project));
    for (const s of list) {
      const b = el("button", undefined, "chat-pick");
      b.type = "button";
      b.dataset.id = s.id;
      if (s.id === current) b.setAttribute("aria-current", "true");
      const dot = el("span", undefined, `st ${s.status}`);
      const ava = avatarOf(s.id);
      b.append(dot);
      if (ava) {
        const img = el("img", undefined, "ava");
        img.src = ava;
        img.alt = ""; // the title next to it says who this is
        b.append(img);
      } else b.append(el("span", undefined, "ava"));
      b.append(el("span", s.title || s.project, "name"));
      b.onclick = () => void (s.id !== current && pick(s.id));
      root.append(b);
    }
  }
  return root;
}
