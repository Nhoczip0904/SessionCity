import type { AskRow } from "../shared/types.js";
import { el } from "./launcher.js";

export interface AskCtx {
  label: (sessionId: string) => string;
  avatarOf: (sessionId: string) => string | null;
  /** resolves to an error message, or null when the answer went through */
  answer: (ask: AskRow, allow: boolean) => Promise<string | null>;
  /** the session's own panel */
  open: (sessionId: string) => void;
}

/** What a session that finished its turn says it is waiting for: its last message, and the ways to answer. */
export function renderWaiting(said: string, go: { chat(): void; open(): void }): HTMLElement {
  const root = el("div", undefined, "waiting");
  const reply = el("button", "Trả lời trong chat", "go");
  const more = el("button", "Xem chi tiết");
  reply.type = more.type = "button";
  reply.onclick = go.chat;
  more.onclick = go.open;
  const acts = el("div", undefined, "ask-acts");
  acts.append(reply, more);
  root.append(el("pre", said || "(chưa đọc được tin nhắn cuối của Claude)"), acts);
  return root;
}

/** The permission questions waiting on the user, each with Allow / Deny. Call again with the new list when it changes. */
export function fillAsks(body: HTMLElement, asks: AskRow[], ctx: AskCtx): void {
  if (!asks.length) return body.replaceChildren(el("div", "Không còn câu hỏi nào đang chờ", "msg"));
  body.replaceChildren(
    ...asks.map((a) => {
      const card = el("div", undefined, "ask");
      const who = el("div", undefined, "ask-who");
      const face = ctx.avatarOf(a.session);
      if (face) {
        const img = el("img");
        img.src = face;
        img.alt = "";
        who.append(img);
      }
      who.append(el("b", ctx.label(a.session)), el("span", a.tool, "ask-tool"));
      const yes = el("button", "Cho phép", "go");
      const no = el("button", "Từ chối");
      const more = el("button", "Xem phiên");
      yes.type = no.type = more.type = "button";
      const err = el("div", undefined, "ask-err");
      const reply = (allow: boolean) => async () => {
        yes.disabled = no.disabled = true;
        const e = await ctx.answer(a, allow);
        if (e) {
          err.textContent = e;
          yes.disabled = no.disabled = false;
        }
      };
      yes.onclick = reply(true);
      no.onclick = reply(false);
      more.onclick = () => ctx.open(a.session);
      card.append(who, el("pre", a.summary), el("div", undefined, "ask-acts"), err);
      card.querySelector(".ask-acts")!.append(yes, no, more);
      return card;
    }),
  );
}
