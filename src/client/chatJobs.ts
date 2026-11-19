// The test-tube rack: a drawer on the right edge of the chat box (under the bookshelf) listing the session's background jobs (e.g. tests run with run_in_background):
// one test tube per job (hover for "⏳ cmd · time") while running, "✓" / "✗" once ended. So there is no need to ask claude whether it is still running. The arrow slides it in and out; it takes no room from the chat.
import type { BgJob } from "../shared/types.js";

const DONE_SHOW = 30_000; // a finished tube leaves the rack after this long (server and client agree)

export const elapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60)}s`;
};

export function jobStrip(): { el: HTMLElement; set(jobs: BgJob[]): void } {
  const el = document.createElement("div");
  el.className = "chat-cabinet";
  el.hidden = true;
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "tab";
  tab.textContent = "▾";
  tab.title = "Thực thi: lệnh đang chạy — thu gọn / mở ra";
  tab.onclick = () => (tab.textContent = el.classList.toggle("in") ? "▸" : "▾");
  const shelf = document.createElement("div");
  shelf.className = "case";
  const cmd = document.createElement("div"); // the command of the tube under the pointer
  cmd.className = "cmd";
  el.append(tab, shelf, cmd);
  let hot: string | null = null;
  let jobs: BgJob[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  const label = (j: BgJob) => `${j.end === undefined ? "⏳" : j.ok ? "✓" : "✗"} ${j.cmd} · ${elapsed((j.end ?? Date.now()) - j.start)}`;
  const draw = () => {
    jobs = jobs.filter((j) => j.end === undefined || Date.now() - j.end < DONE_SHOW);
    el.hidden = !jobs.length;
    if (!jobs.length && timer) (clearInterval(timer), (timer = null));
    cmd.textContent = jobs.find((j) => j.id === hot) ? label(jobs.find((j) => j.id === hot)!) : "";
    shelf.replaceChildren(
      ...jobs.map((j) => {
        const c = document.createElement("div");
        c.className = "slot";
        const t = document.createElement("div");
        t.className = `tube ${j.end === undefined ? "run" : j.ok ? "ok" : "bad"}`;
        const time = elapsed((j.end ?? Date.now()) - j.start);
        t.title = label(j);
        c.onmouseenter = () => ((hot = j.id), (cmd.textContent = label(j)));
        c.onmouseleave = () => ((hot = null), (cmd.textContent = ""));
        t.append(document.createElement("i")); // the liquid: green ok, red failed, bubbling yellow while running
        const cap = document.createElement("small"); // time under the tube
        cap.textContent = time;
        c.append(t, cap);
        return c;
      }),
    );
  };
  return {
    el,
    set(next) {
      jobs = next;
      draw();
      if (jobs.length && !timer) timer = setInterval(draw, 1000); // ticks the clocks, and removes finished tubes on time
    },
  };
}
