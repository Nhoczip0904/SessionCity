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
  on: { launch: () => void; summary: () => void; rules: () => void; rock: (armed: boolean) => void; grab: (armed: boolean) => void; plaza: (shown: boolean) => void; photo: (file: File) => void; agents: (shown: boolean) => void },
  plazaOn: boolean,
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
  // rock and throw are two tools for the same map: arming one puts the other down
  const tools = [
    { btn: $("btn-rock"), set: on.rock },
    { btn: $("btn-grab"), set: on.grab },
  ];
  for (const t of tools)
    t.btn.onclick = () => {
      const armed = t.btn.getAttribute("aria-pressed") !== "true";
      t.btn.setAttribute("aria-pressed", String(armed));
      t.set(armed);
      if (!armed) return;
      for (const o of tools) if (o !== t && o.btn.getAttribute("aria-pressed") === "true") { o.btn.setAttribute("aria-pressed", "false"); o.set(false); }
    };
  const plaza = $("btn-plaza"), photo = $("btn-photo"), file = $("photo-file") as HTMLInputElement;
  const showPlaza = (shown: boolean) => {
    plaza.setAttribute("aria-pressed", String(shown));
    photo.hidden = !shown;
  };
  showPlaza(plazaOn);
  plaza.onclick = () => {
    const shown = plaza.getAttribute("aria-pressed") !== "true";
    showPlaza(shown);
    on.plaza(shown);
  };
  photo.onclick = () => file.click();
  file.onchange = () => {
    const f = file.files?.[0];
    file.value = ""; // picking the same file again still fires
    if (f) on.photo(f);
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
