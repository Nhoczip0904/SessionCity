import { unwatchFile, watchFile } from "node:fs";

/** Calls `cb` whenever the file changes (polled, which also works for a file that appears later); returns a stop function. */
export function follow(file: string, cb: () => void, intervalMs = 700): () => void {
  const on = (cur: { mtimeMs: number; size: number }, prev: { mtimeMs: number; size: number }) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) cb();
  };
  watchFile(file, { interval: intervalMs, persistent: false }, on);
  return () => unwatchFile(file, on);
}
