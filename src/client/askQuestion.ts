import { el } from "./launcher.js";

export interface Question { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }

/** The questions of an AskUserQuestion input, or null when it is not shaped like one. */
export function questionsOf(input: unknown): Question[] | null {
  const qs = (input as { questions?: unknown } | null | undefined)?.questions;
  const ok = Array.isArray(qs) && qs.length > 0 && qs.every((q) => typeof q?.question === "string" && Array.isArray(q.options) && q.options.length > 0 && q.options.every((o: { label?: unknown }) => typeof o?.label === "string"));
  return ok ? (qs as Question[]) : null;
}

/** Claude's own question card: pick an option (or several, or type your own) per question, then Send; Skip refuses. */
export function renderQuestions(qs: Question[], done: (answers: Record<string, string>) => void, skip: () => void): HTMLElement {
  const card = el("div", undefined, "perm askq");
  const picked = qs.map(() => new Set<number>()), typed = qs.map(() => "");
  const send = el("button", "Gửi", "allow aq-send");
  const no = el("button", "Bỏ qua", "deny aq-skip");
  send.type = no.type = "button";
  const answer = (i: number) => (typed[i] ? typed[i] : qs[i].options.filter((_, k) => picked[i].has(k)).map((o) => o.label).join(", "));
  const refresh = () => void (send.disabled = !qs.every((_, i) => answer(i)));
  const locks: HTMLButtonElement[] = [send, no];
  qs.forEach((q, i) => {
    const box = el("div", undefined, "aq");
    if (q.header) box.append(el("div", q.header, "aq-head"));
    box.append(el("div", q.question, "aq-q"));
    const opts = q.options.map((o, k) => {
      const b = el("button", undefined, "aq-opt");
      b.type = "button";
      b.append(el("b", o.label), ...(o.description ? [el("small", o.description)] : []));
      b.setAttribute("aria-pressed", "false");
      b.onclick = () => {
        if (!q.multiSelect) picked[i].clear();
        if (!picked[i].delete(k) || !q.multiSelect) picked[i].add(k);
        typed[i] = "";
        other.value = "";
        opts.forEach((x, n) => x.setAttribute("aria-pressed", String(picked[i].has(n))));
        refresh();
      };
      locks.push(b);
      return b;
    });
    const other = el("input", undefined, "aq-other");
    other.type = "text";
    other.placeholder = "Khác…";
    other.oninput = () => {
      typed[i] = other.value.trim();
      if (typed[i]) {
        picked[i].clear();
        opts.forEach((x) => x.setAttribute("aria-pressed", "false"));
      }
      refresh();
    };
    box.append(...opts, other);
    card.append(box);
  });
  let sent = false;
  const finish = (f: () => void) => {
    if (sent) return;
    sent = true;
    card.querySelectorAll("input").forEach((x) => (x.disabled = true));
    locks.forEach((b) => (b.disabled = true));
    f();
  };
  send.onclick = () => finish(() => done(Object.fromEntries(qs.map((q, i) => [q.question, answer(i)]))));
  no.onclick = () => finish(skip);
  refresh();
  const acts = el("div", undefined, "acts");
  acts.append(send, no);
  card.append(acts);
  return card;
}
