// @vitest-environment happy-dom
import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { Cross, coverCrop } from "../src/client/cross.js";

const RECT = { x: 100, y: 50, w: 64, h: 114 };

describe("a rock at the photo on the cross", () => {
  const setup = () => {
    const layer = new Container();
    const cross = new Cross(layer, RECT, null);
    const p = cross.photo;
    const mid = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    const booms = () => layer.children.filter((k) => k.label === "boom").length;
    return { layer, cross, p, mid, booms };
  };

  it("a hit on the photo blows up there and leaves a bruise; a miss does nothing", () => {
    const { cross, p, mid, booms } = setup();
    expect(cross.hit(mid)).toBe(true);
    expect(cross.bruises).toBe(1);
    expect(booms()).toBe(1);
    expect(cross.hit({ x: p.x - 5, y: p.y })).toBe(false);
    expect(cross.hit({ x: mid.x, y: p.y + p.h + 30 })).toBe(false); // the post, below the photo
    expect(cross.bruises).toBe(1);
    expect(booms()).toBe(1);
  });

  it("bruises fade away in time", () => {
    const { cross, mid } = setup();
    for (let i = 0; i < 4; i++) cross.hit(mid);
    cross.update(5000);
    expect(cross.bruises).toBe(4);
    cross.update(6000);
    expect(cross.bruises).toBe(0);
  });

  it("the fifth hit destroys the photo: more blasts, nothing to hit, then it is hung again", () => {
    const { cross, mid, booms } = setup();
    for (let i = 0; i < 4; i++) cross.hit(mid);
    expect(cross.broken).toBe(false);
    expect(cross.hit(mid)).toBe(true);
    expect(cross.broken).toBe(true);
    cross.update(900);
    expect(booms()).toBeGreaterThan(5); // the hits plus the chain of blasts
    expect(cross.hit(mid)).toBe(false);
    cross.update(7200);
    expect(cross.broken).toBe(false);
    expect(cross.bruises).toBe(0);
    expect(cross.hit(mid)).toBe(true);
  });

  it("a hidden cross cannot be hit; shown again, it can", () => {
    const { cross, mid } = setup();
    cross.show(false);
    expect(cross.hit(mid)).toBe(false);
    cross.show(true);
    expect(cross.hit(mid)).toBe(true);
  });

  it("a new photo replaces the old one on the card", () => {
    const { layer, cross, mid } = setup();
    const shows = (c: Container): boolean => c.children.some((k) => (k instanceof Sprite && k.texture === Texture.WHITE) || shows(k));
    expect(shows(layer)).toBe(false);
    cross.setPhoto(Texture.WHITE);
    expect(shows(layer)).toBe(true);
    expect(cross.hit(mid)).toBe(true);
  });
});

describe("cropping an upload to the 3:4 card", () => {
  it("cuts the sides off a wide picture and the top and bottom off a tall one, keeping the middle", () => {
    expect(coverCrop(800, 600)).toEqual({ sx: 175, sy: 0, sw: 450, sh: 600 });
    expect(coverCrop(300, 800)).toEqual({ sx: 0, sy: 200, sw: 300, sh: 400 });
    expect(coverCrop(300, 400)).toEqual({ sx: 0, sy: 0, sw: 300, sh: 400 });
  });
});
