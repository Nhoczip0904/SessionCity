import type { Session } from "../shared/types.js";
import type { Conn } from "./net.js";

const $ = (id: string) => document.getElementById(id)!;
const CONN_TEXT: Record<Conn, string> = {
  connecting: "Đang kết nối…",
  open: "Đã kết nối",
  closed: "Mất kết nối — đang thử lại",
  auth: "Thiếu token",
};

export function createHud(on: { launch: () => void; rules: () => void }) {
  $("btn-launch").onclick = on.launch;
  $("btn-rules").onclick = on.rules;
  return {
    setCounts(sessions: Session[]) {
      for (const k of ["working", "waiting", "idle"] as const) $(`n-${k}`).textContent = String(sessions.filter((s) => s.status === k).length);
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
