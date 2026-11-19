import type { Session } from "../shared/types.js";
import type { Conn } from "./net.js";

const $ = (id: string) => document.getElementById(id)!;
const CONN_TEXT: Record<Conn, string> = {
  connecting: "Đang kết nối…",
  open: "Đã kết nối",
  closed: "Mất kết nối — đang thử lại",
  auth: "Thiếu token",
};

export function createHud(
  on: { launch: () => void; summary: () => void; rules: () => void; rock: (armed: boolean) => void; grab: (armed: boolean) => void; bolt: (armed: boolean) => void; meteor: (armed: boolean) => void; sniper: (armed: boolean) => void; laser: (armed: boolean) => void; sandbox: (on: boolean) => void; sbx: (kind: string, armed: boolean) => void; agents: (shown: boolean) => void },
  agentsOn: boolean,
) {
  const agentsBtn = $("btn-agents"), agents = $("agents");
  const showAgents = (shown: boolean) => {
    agentsBtn.setAttribute("aria-pressed", String(shown));
    agents.hidden = !shown;
  };
  showAgents(agentsOn);
  agentsBtn.onclick = () => {
    const shown = agentsBtn.getAttribute("aria-pressed") !== "true";
    showAgents(shown);
    on.agents(shown);
  };
  $("btn-launch").onclick = on.launch;
  $("btn-summary").onclick = on.summary;
  $("btn-rules").onclick = on.rules;
  // rock, throw and lightning are tools for the same map in one drop-down: arming one puts the others down
  const tools = [
    { btn: $("btn-rock"), set: on.rock },
    { btn: $("btn-grab"), set: on.grab },
    { btn: $("btn-bolt"), set: on.bolt },
    { btn: $("btn-meteor"), set: on.meteor },
    { btn: $("btn-sniper"), set: on.sniper },
    { btn: $("btn-laser"), set: on.laser },
  ];
  // sandbox: its tools stay hidden until the mode is on; they share the one-at-a-time rule with the toys above
  const sbx = [...document.querySelectorAll<HTMLElement>("[data-sbx]")];
  for (const btn of sbx) tools.push({ btn, set: (armed) => on.sbx(btn.dataset.sbx!, armed) });
  const sandbox = $("btn-sandbox");
  sandbox.onclick = () => {
    const onNow = sandbox.getAttribute("aria-pressed") !== "true";
    sandbox.setAttribute("aria-pressed", String(onNow));
    for (const btn of sbx) {
      btn.hidden = !onNow;
      if (!onNow && btn.getAttribute("aria-pressed") === "true") { btn.setAttribute("aria-pressed", "false"); on.sbx(btn.dataset.sbx!, false); }
    }
    on.sandbox(onNow);
  };
  const menu = $("toys") as HTMLDetailsElement, sum = $("toys-sum");
  for (const t of tools)
    t.btn.onclick = () => {
      const armed = t.btn.getAttribute("aria-pressed") !== "true";
      t.btn.setAttribute("aria-pressed", String(armed));
      t.set(armed);
      if (armed) for (const o of tools) if (o !== t && o.btn.getAttribute("aria-pressed") === "true") { o.btn.setAttribute("aria-pressed", "false"); o.set(false); }
      sum.textContent = armed ? `🎯 ${t.btn.textContent}` : "🎯 Trò chơi";
      sum.setAttribute("aria-pressed", String(armed));
      menu.open = false;
    };
  return {
    setCounts(sessions: Session[]) {
      for (const k of ["working", "waiting", "idle"] as const) $(`n-${k}`).textContent = String(sessions.filter((s) => s.status === k).length);
    },
    setDone(n: number) {
      $("n-done").textContent = String(n);
    },
    setConn(c: Conn) {
      const dot = $("conn");
      dot.className = `dot ${c}`;
      dot.title = CONN_TEXT[c];
    },
    setPlace(name: string | null, onBack: () => void) {
      $("btn-back").hidden = $("place-name").hidden = name === null;
      $("place-name").textContent = name ?? "";
      $("btn-back").onclick = onBack;
    },
    setHint(text: string | null) {
      const el = $("hint");
      el.textContent = text ?? "";
      el.hidden = !text;
    },
  };
}
