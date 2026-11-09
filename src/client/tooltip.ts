import type { DistrictInfo } from "../shared/districts.js";
import type { District } from "../shared/types.js";

const MAX_PRESENT = 6;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

export function renderDistrictCard(info: DistrictInfo, present: string[]): HTMLElement {
  const card = el("div", undefined, "district-card");
  const head = el("div", undefined, "dc-head");
  head.append(el("b", info.label), " · ", info.sign);
  card.append(head, el("p", info.description));
  if (info.examples.length) {
    card.append(el("div", "Agent tới đây khi:"));
    const ul = el("ul");
    for (const x of info.examples) ul.append(el("li", x));
    card.append(ul);
  }
  const names = present.slice(0, MAX_PRESENT).join(", ") + (present.length > MAX_PRESENT ? "…" : "");
  card.append(el("div", `Đang có mặt: ${names || "—"}`));
  return card;
}

export function presentAt(
  district: District,
  sessions: { district: District; project: string }[],
  employees: { district: District; type: string; status: string }[],
): string[] {
  return [
    ...sessions.filter((x) => x.district === district).map((x) => x.project),
    ...employees.filter((x) => x.district === district && x.status === "working").map((x) => x.type),
  ];
}

export function plotAt<T extends { id: District; px: { x: number; y: number; w: number; h: number } }>(plots: T[], x: number, y: number): T | undefined {
  return plots.find((p) => x >= p.px.x && x < p.px.x + p.px.w && y >= p.px.y && y < p.px.y + p.px.h);
}

export class Tooltip {
  constructor(private root: HTMLElement) {
    root.hidden = true;
  }
  /** Place near the cursor (14 px offset), clamped inside the viewport. */
  show(content: HTMLElement, x: number, y: number, vw: number, vh: number) {
    this.root.replaceChildren(content);
    this.root.hidden = false;
    const left = Math.max(0, Math.min(x + 14, vw - this.root.offsetWidth));
    const top = Math.max(0, Math.min(y + 14, vh - this.root.offsetHeight));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }
  hide() {
    this.root.hidden = true;
  }
}
