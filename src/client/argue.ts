import { Container, Text } from "pixi.js";
import type { Pt } from "./path.js";

export const LINES = ["Chỗ này null kìa!", "Thiếu test nha", "Tên biến khó hiểu quá", "Cái này tách hàm đi", "Ổn mà, merge đi", "Không, sửa lại đã!", "Edge case đâu?", "Em thấy hơi bloat"];
const GAP_MS = 1800, SHOW_MS = 2200;

/** Meeting-room chatter: every GAP_MS someone at `spots` (pixels, above each head) says a line for SHOW_MS. Returns the per-frame step. */
export function argue(parent: Container, spots: Pt[], rand: () => number = Math.random): (dtMs: number) => void {
  const bubble = new Text({ text: "", style: { fontFamily: "Consolas, monospace", fontSize: 7, fill: 0xffffff, stroke: { color: 0x111111, width: 2 } }, resolution: 4, textureStyle: { scaleMode: "linear" } });
  bubble.anchor.set(0.5, 1);
  bubble.visible = false;
  bubble.eventMode = "none";
  bubble.zIndex = 1e7;
  parent.addChild(bubble);
  let wait = GAP_MS, left = 0;
  return (dt) => {
    if (!spots.length || bubble.destroyed) return;
    if (left > 0 && (left -= dt) <= 0) { bubble.visible = false; wait = GAP_MS; return; }
    if (left > 0 || (wait -= dt) > 0) return;
    const at = spots[Math.floor(rand() * spots.length)];
    bubble.text = LINES[Math.floor(rand() * LINES.length)];
    bubble.position.set(at.x, at.y);
    bubble.visible = true;
    left = SHOW_MS;
    wait = GAP_MS;
  };
}
