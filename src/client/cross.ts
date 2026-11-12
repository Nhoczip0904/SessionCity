import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { boom } from "./traffic.js";

type Rect = { x: number; y: number; w: number; h: number };

const BRUISE_MS = 10000; // a bruise stays this long
const FADE_MS = 1500; // and fades out over its last stretch
const SHAKE_MS = 600;
const BREAK_AT = 5; // hits that destroy the photo
const BLASTS = [0, 250, 500, 800]; // ms after the photo is destroyed; one blast each
const REHANG_MS = 8000; // then a fresh copy is hung

/** A wooden cross on the square with a photo nailed to it; rocks bruise it, rock it and finally blow it apart. */
export class Cross {
  readonly photo: Rect;
  private root = new Container();
  private card = new Container(); // the photo, its frame and bruises
  private face: Container;
  private marks = new Graphics();
  private wreck = new Graphics(); // burnt scraps at the foot of the post
  private hits: { x: number; y: number; t: number }[] = [];
  private shake = SHAKE_MS;
  private strikes = 0;
  private down = -1; // ms since the photo was destroyed, -1 while it hangs
  private nextBlast = 0;

  constructor(private layer: Container, r: Rect, tex: Texture | null) {
    const cx = r.x + r.w / 2, base = r.y + r.h - 4;
    const pw = Math.round(r.w * 0.55), ph = Math.round((pw * 4) / 3);
    this.photo = { x: Math.round(cx - pw / 2), y: r.y + 16, w: pw, h: ph };
    const p = this.photo;
    this.root.label = "cross";
    this.root.eventMode = "none";
    this.root.pivot.set(cx, base); // rocks from the foot of the post
    this.root.position.set(cx, base);
    const wood = new Graphics()
      .ellipse(cx, base + 1, r.w * 0.35, 4).fill(0x6b5038) // dirt mound
      .rect(cx - 3, r.y, 6, base - r.y).fill(0x7a5230)
      .rect(cx - 3, r.y, 2, base - r.y).fill(0x9a6a40)
      .rect(r.x, r.y + 24, r.w, 6).fill(0x7a5230)
      .rect(r.x, r.y + 24, r.w, 2).fill(0x9a6a40);
    this.face = this.makeFace(tex);
    const frame = new Graphics()
      .rect(p.x - 1, p.y - 1, p.w + 2, p.h + 2).stroke({ color: 0x3a2a1a, width: 1 })
      .rect(cx - 1, p.y + 1, 2, 2).fill(0x9a9a9a); // nail
    this.card.addChild(this.face, frame, this.marks);
    this.root.addChild(wood, this.wreck, this.card);
    layer.addChild(this.root);
  }

  /** Hang a different photo; a blank card without one. */
  setPhoto(tex: Texture | null): void {
    const old = this.face;
    this.face = this.makeFace(tex);
    this.card.addChildAt(this.face, 0);
    old.destroy();
  }

  /** Put the cross up or take it down; a hidden cross takes no rocks. */
  show(on: boolean): void {
    this.root.visible = on;
  }

  private makeFace(tex: Texture | null): Container {
    const p = this.photo;
    if (!tex) return new Graphics().rect(p.x, p.y, p.w, p.h).fill(0xe8e0d0);
    tex.source.scaleMode = "linear"; // a face reads better smooth than pixelated
    const s = new Sprite(tex);
    s.position.set(p.x, p.y);
    s.setSize(p.w, p.h);
    return s;
  }

  get bruises(): number {
    return this.hits.length;
  }

  get broken(): boolean {
    return this.down >= 0;
  }

  /** A rock landed at (x, y) px: it blows up on the photo, bruises it, and the fifth one destroys it. */
  hit(at: { x: number; y: number }): boolean {
    const p = this.photo;
    if (!this.root.visible || this.broken || at.x < p.x || at.x > p.x + p.w || at.y < p.y || at.y > p.y + p.h) return false;
    boom(this.layer, at.x, at.y, 0.8);
    this.hits.push({ x: at.x, y: at.y, t: 0 });
    this.shake = 0;
    if (++this.strikes >= BREAK_AT) {
      this.down = 0;
      this.nextBlast = 0;
      this.hits = [];
      this.card.visible = false;
    }
    this.update(0);
    return true;
  }

  update(dtMs: number): void {
    this.shake += dtMs;
    const s = Math.min(1, this.shake / SHAKE_MS);
    this.root.rotation = Math.sin(this.shake / 35) * 0.15 * (1 - s);
    for (const h of this.hits) h.t += dtMs;
    this.hits = this.hits.filter((h) => h.t < BRUISE_MS);
    this.drawBruises();
    if (this.down < 0) return;
    this.down += dtMs;
    const p = this.photo;
    while (this.nextBlast < BLASTS.length && this.down >= BLASTS[this.nextBlast]!) {
      const k = this.nextBlast++;
      // spread over the photo, biggest first
      boom(this.layer, p.x + p.w * (0.5 + 0.3 * Math.cos(k * 2.1)), p.y + p.h * (0.5 + 0.3 * Math.sin(k * 2.1)), k ? 1.6 : 2.4);
    }
    if (this.down >= REHANG_MS) {
      this.down = -1;
      this.strikes = 0;
      this.card.visible = true;
      this.wreck.clear();
      return;
    }
    this.drawWreck(this.down);
  }

  private drawBruises() {
    const g = this.marks.clear();
    for (const h of this.hits) {
      const a = Math.min(1, (BRUISE_MS - h.t) / FADE_MS);
      g.circle(h.x, h.y, 3.5).fill({ color: 0x6a2a5a, alpha: 0.6 * a });
      g.circle(h.x, h.y, 1.8).fill({ color: 0xc0304a, alpha: 0.9 * a });
      g.moveTo(h.x - 4, h.y - 3).lineTo(h.x, h.y).lineTo(h.x + 3, h.y - 4).moveTo(h.x, h.y).lineTo(h.x + 1, h.y + 4)
        .stroke({ color: 0x2a1a1a, width: 0.6, alpha: a }); // cracks in the print
    }
  }

  /** The photo's burnt halves fall to the foot of the post, a torn scrap stays nailed, small fires and smoke. */
  private drawWreck(t: number) {
    const p = this.photo, g = this.wreck.clear();
    const cx = p.x + p.w / 2, foot = this.root.pivot.y;
    const fall = Math.min(1, t / 700); // the halves drop in the first 0.7 s
    g.alpha = Math.min(1, (REHANG_MS - t) / FADE_MS);
    g.poly([cx - 4, p.y - 1, cx + 5, p.y - 1, cx + 2, p.y + 6, cx - 2, p.y + 4]).fill(0x2a2018); // scrap under the nail
    const y = p.y + (foot - 6 - p.y) * fall * fall;
    g.rect(cx - p.w / 2 - 4, y, p.w / 2, 5).fill(0x241a14).rect(cx - p.w / 2 - 2, y + 1, p.w / 2 - 6, 2).fill(0x5a3a28);
    g.rect(cx + 4, y + 1, p.w / 2, 5).fill(0x241a14).rect(cx + 6, y + 2, p.w / 2 - 6, 2).fill(0x5a3a28);
    if (t < 4000) {
      // flames licking the scraps, flickering
      for (let k = 0; k < 3; k++) {
        const fx = cx + (k - 1) * 10, fl = 3 + Math.abs(Math.sin(t / 70 + k * 1.7)) * 4;
        g.poly([fx - 2.5, y + 1, fx + 2.5, y + 1, fx, y - fl]).fill({ color: 0xff7a20, alpha: 1 - t / 4000 });
        g.poly([fx - 1, y + 1, fx + 1, y + 1, fx, y - fl * 0.6]).fill({ color: 0xffe066, alpha: 1 - t / 4000 });
      }
    }
    for (let k = 0; k < 3; k++) {
      // smoke columns rising from the scraps, in a loop
      const q = (t / 1400 + k / 3) % 1;
      g.circle(cx + (k - 1) * 9, y - 4 - q * 30, 3 + q * 7).fill({ color: 0x555555, alpha: 0.5 * (1 - q) });
    }
  }
}

/** The middle part of a w×h picture that has the card's 3:4 shape. */
export function coverCrop(w: number, h: number): { sx: number; sy: number; sw: number; sh: number } {
  if (w / h > 3 / 4) {
    const sw = Math.round((h * 3) / 4);
    return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h };
  }
  const sh = Math.round((w * 4) / 3);
  return { sx: 0, sy: Math.round((h - sh) / 2), sw: w, sh };
}

/** An uploaded image file cropped to 3:4 and shrunk to 96×128, as a small JPEG data URL; throws if it is not a readable image. */
export async function photoDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const { sx, sy, sw, sh } = coverCrop(bmp.width, bmp.height);
  const cv = document.createElement("canvas");
  cv.width = 96;
  cv.height = 128;
  cv.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, 96, 128);
  bmp.close();
  return cv.toDataURL("image/jpeg", 0.85);
}
