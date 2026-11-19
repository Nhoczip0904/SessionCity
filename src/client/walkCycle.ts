// Frames for an agent's chat chip, all made from the one still portrait: a walk cycle, work poses and tricks.
// Each frame is the portrait with its parts moved: head (rows 0-6), torso, arms (outer quarters of the torso rows), legs (bottom rows).
// Sprites are 16 rows; offsets and rows are scaled by h/16 so a bigger render still works.
type Off = [number, number];
interface Spec {
  body?: Off; // moves head, torso and arms together
  head?: Off; armL?: Off; armR?: Off; // on top of body
  legL?: Off; legR?: Off; // alone: the feet do not follow the body
  sx?: number; sy?: number; // squash across (negative mirrors) or down, anchored on the centre / the ground
  rot?: number; // quarter turns clockwise
  at?: Off; // shift after everything else
}

/** Frame groups, in strip order; each pose's start column is `FRAME_AT[name]` (the CSS has the same numbers x -32px). */
const POSES: [string, Spec[]][] = [
  ["walk", [
    { legL: [-1, 0], legR: [1, 0], armL: [0, 1], armR: [0, -1] },
    { body: [0, -1] },
    { legL: [1, 0], legR: [-1, 0], armL: [0, -1], armR: [0, 1] },
    { body: [0, -1] },
  ]],
  ["write", [{ head: [0, 1], armR: [1, -2] }, { head: [0, 1], armR: [2, -1] }]],
  ["think", [{ armR: [-3, -4] }, { armR: [-3, -4], head: [1, 0] }]],
  ["pushup", [{ rot: 1 }, { rot: 1, at: [0, 2] }]],
  ["coffee", [{ armR: [-3, -5] }, { armR: [-3, -5], head: [1, 0] }]],
  ["hop", [{ sy: 0.8 }, { armL: [0, -4], armR: [0, -4], legL: [0, -2], legR: [0, -2] }, { sy: 0.85 }]],
  ["dance", [
    { body: [-1, 0], armL: [0, -5], armR: [0, -2] },
    { body: [0, -1], armL: [0, -5], armR: [0, -5] },
    { body: [1, 0], armL: [0, -2], armR: [0, -5] },
    { body: [0, -1], armL: [0, -5], armR: [0, -5] },
  ]],
  ["spin", [{ sx: 1 }, { sx: 0.5 }, { sx: 0.12 }, { sx: -0.5 }]],
  ["flip", [{ rot: 0 }, { rot: 3 }, { rot: 2 }, { rot: 1 }]],
  ["shake", [{ head: [-1, 0], armL: [0, -3], armR: [0, -3] }, { head: [1, 0], armL: [0, -3], armR: [0, -3] }]],
  ["peek", [{ head: [-1, 0] }, { head: [1, 0] }]],
];
export const FRAME_AT: Record<string, number> = {};
const SPECS: Spec[] = [];
for (const [name, frames] of POSES) { FRAME_AT[name] = SPECS.length; SPECS.push(...frames); }
export const FRAMES = SPECS.length;
export const WALK_FRAMES = POSES[0]![1].length;

/** Frame k of the strip, from RGBA pixels w×h. A pixel pushed off the image is dropped. */
export function walkFrame(src: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray<ArrayBuffer> {
  const s = SPECS[k]!;
  const u = h / 16;
  const legTop = Math.round(13 * u), armTop = Math.round(7 * u);
  const body = s.body ?? [0, 0];
  let cur = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!src[i + 3]) continue;
      const left = x < w / 2;
      let o: Off;
      if (y >= legTop) o = (left ? s.legL : s.legR) ?? [0, 0];
      else {
        const part = y < armTop ? s.head : x < w / 4 ? s.armL : x >= (w * 3) / 4 ? s.armR : undefined;
        o = [body[0] + (part?.[0] ?? 0), body[1] + (part?.[1] ?? 0)];
      }
      const nx = x + Math.round(o[0] * u), ny = y + Math.round(o[1] * u);
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) cur.set(src.subarray(i, i + 4), (ny * w + nx) * 4);
    }
  }
  const warp = (from: (x: number, y: number) => [number, number]) => { // pull each output pixel from where from() says
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [sx, sy] = from(x, y);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) out.set(cur.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
    }
    cur = out;
  };
  if (s.sy) warp((x, y) => [x, Math.round(h - 1 - (h - 1 - y) / s.sy!)]);
  if (s.sx) warp((x, y) => [Math.round((w - 1) / 2 + (x - (w - 1) / 2) / s.sx!), y]);
  if (w === h) for (let r = 0; r < (s.rot ?? 0); r++) warp((x, y) => [y, h - 1 - x]); // a clockwise quarter turn
  if (s.at) { const [ax, ay] = s.at; warp((x, y) => [x - Math.round(ax * u), y - Math.round(ay * u)]); }
  return cur as Uint8ClampedArray<ArrayBuffer>;
}

/** All frames side by side as one data URL, each drawn `scale` times bigger with hard pixels; null when no canvas. */
export function walkStrip(img: HTMLImageElement, scale: number): string | null {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const read = document.createElement("canvas");
  read.width = w;
  read.height = h;
  const rc = read.getContext("2d");
  if (!rc) return null;
  rc.drawImage(img, 0, 0);
  const src = rc.getImageData(0, 0, w, h).data;
  const strip = document.createElement("canvas");
  strip.width = w * scale * FRAMES;
  strip.height = h * scale;
  const sc = strip.getContext("2d")!;
  sc.imageSmoothingEnabled = false;
  for (let k = 0; k < FRAMES; k++) {
    rc.putImageData(new ImageData(walkFrame(src, w, h, k), w, h), 0, 0);
    sc.drawImage(read, k * w * scale, 0, w * scale, h * scale);
  }
  return strip.toDataURL();
}
