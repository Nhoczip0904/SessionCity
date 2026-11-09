import type { Delta, State } from "../shared/types.js";

export type Conn = "connecting" | "open" | "closed" | "auth";

/** Fetch /api/state then hold a WebSocket; reconnect 1 s → 2 s → 4 s … max 10 s. Stops on a missing/rejected token. */
export function connect(onState: (s: State) => void, onDelta: (d: Delta) => void, onConn: (c: Conn) => void = () => {}) {
  const token = new URLSearchParams(location.search).get("token");
  if (!token) return onConn("auth");
  const q = `token=${encodeURIComponent(token)}`;
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${q}`;
  let delay = 1000;

  const retry = () => {
    onConn("closed");
    setTimeout(cycle, delay);
    delay = Math.min(delay * 2, 10_000);
  };

  async function cycle() {
    onConn("connecting");
    try {
      const res = await fetch(`/api/state?${q}`);
      if (res.status === 401) return onConn("auth"); // WS close codes can't tell a bad token from a dead server
      if (!res.ok) return retry();
      onState((await res.json()) as State);
    } catch {
      return retry();
    }
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      delay = 1000;
      onConn("open");
    };
    ws.onmessage = (ev) => {
      let msg: { type: string; state?: State; delta?: Delta };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "state" && msg.state) onState(msg.state);
      else if (msg.type === "delta" && msg.delta) onDelta(msg.delta);
    };
    ws.onclose = retry;
  }

  void cycle();
}
