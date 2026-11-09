import { open } from "node:fs/promises";

const CHUNK = 1024 * 1024;

export function tailStart(size: number, maxBytes = 2 * 1024 * 1024): number {
  return Math.max(0, size - maxBytes);
}

export class Tailer {
  private pos: number;
  private pending: Buffer = Buffer.alloc(0); // bytes, not string: a split multi-byte char survives
  private skipFirst: boolean; // still discarding the cut first line

  constructor(private path: string, offset = 0) {
    this.pos = offset;
    this.skipFirst = offset > 0;
  }

  get offset(): number {
    return this.pos;
  }

  /** Must not be called concurrently on the same Tailer (the watcher calls it from a single loop). */
  async read(): Promise<string[]> {
    let fh;
    try {
      fh = await open(this.path, "r");
    } catch {
      return [];
    }
    try {
      const { size } = await fh.stat();
      if (size < this.pos) {
        this.pos = 0;
        this.pending = Buffer.alloc(0);
        this.skipFirst = false;
      }
      const lines: string[] = [];
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(size - this.pos, 0)));
      while (this.pos < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - this.pos), this.pos);
        if (bytesRead === 0) break;
        this.pos += bytesRead;
        let chunk = buf.subarray(0, bytesRead);
        if (this.skipFirst) {
          const nl = chunk.indexOf(10);
          if (nl < 0) continue;
          chunk = chunk.subarray(nl + 1);
          this.skipFirst = false;
        }
        const data = Buffer.concat([this.pending, chunk]);
        const last = data.lastIndexOf(10);
        if (last < 0) {
          this.pending = data;
          continue;
        }
        this.pending = Buffer.from(data.subarray(last + 1));
        for (const line of data.toString("utf8", 0, last).split("\n")) {
          const l = line.endsWith("\r") ? line.slice(0, -1) : line;
          if (l) lines.push(l);
        }
      }
      return lines;
    } finally {
      await fh.close();
    }
  }
}
