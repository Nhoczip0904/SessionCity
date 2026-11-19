// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { refreshStaff, staffStrip } from "../src/client/chatStaff.js";
import type { Employee } from "../src/shared/types.js";

const emp = (id: string, sessionId: string, status: Employee["status"], description = id): Employee =>
  ({ id, sessionId, type: "coder", description, prompt: "", toolUseId: "t" + id, status, district: "home", startedAt: "", tokens: {} }) as unknown as Employee;
const finish = (chip: Element) => chip.dispatchEvent(new Event("transitionend"));

describe("chat staff strip", () => {
  it("shows only this session's working subagents, with their face, and hides when none", () => {
    const strip = staffStrip("s1");
    document.body.append(strip);
    expect(strip.hidden).toBe(true);
    refreshStaff([emp("a", "s1", "working", "Sửa test"), emp("b", "s1", "done"), emp("c", "s2", "working")], (id) => (id === "a" ? "data:img/a" : null));
    expect(strip.hidden).toBe(false);
    const chips = [...strip.querySelectorAll<HTMLElement>(".staff")];
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toContain("Sửa test");
    expect(chips[0]!.querySelector("img")!.getAttribute("src")).toBe("data:img/a");
    expect(chips[0]!.classList.contains("face")).toBe(true); // face only; the full name is the hover title
    expect(chips[0]!.title).toBe(""); // no native tooltip: the name slides out on hover
    vi.useFakeTimers();
    refreshStaff([emp("a", "s1", "done")], () => null);
    vi.advanceTimersByTime(5000); // says "done", runs off, then gone
    vi.useRealTimers();
    expect(strip.hidden).toBe(true);
    strip.remove();
  });

  it("a subagent without a face yet still gets a chip; a strip off the page is forgotten", () => {
    const strip = staffStrip("s1");
    document.body.append(strip);
    refreshStaff([emp("a", "s1", "working")], () => null);
    expect(strip.querySelector(".staff img")).toBeNull();
    expect(strip.querySelectorAll(".staff")).toHaveLength(1);
    strip.remove();
    refreshStaff([emp("a", "s1", "working"), emp("b", "s1", "working")], () => null);
    expect(strip.querySelectorAll(".staff")).toHaveLength(1); // detached: left alone
  });

  it("a new strip draws what is already working", () => {
    refreshStaff([emp("a", "s9", "working")], () => null);
    const strip = staffStrip("s9");
    expect(strip.querySelectorAll(".staff")).toHaveLength(1);
  });

  it("a running chip is kept across updates, so its walk is not restarted", () => {
    const strip = staffStrip("s3");
    document.body.append(strip);
    refreshStaff([emp("a", "s3", "working")], () => null);
    const chip = strip.querySelector(".staff");
    refreshStaff([emp("a", "s3", "working"), emp("b", "s3", "working")], () => null);
    expect(strip.querySelectorAll(".staff")).toHaveLength(2);
    expect(strip.querySelector(".staff")).toBe(chip);
    strip.remove();
  });

  it("a finished subagent says it is done, then runs off the right edge and its chip goes", () => {
    vi.useFakeTimers();
    const strip = staffStrip("s4");
    document.body.append(strip);
    refreshStaff([emp("a", "s4", "working")], () => null);
    const chip = strip.querySelector<HTMLElement>(".staff")!;
    refreshStaff([emp("a", "s4", "done")], () => null);
    expect(chip.querySelector(".say")!.textContent).toContain("Xong");
    expect(chip.classList.contains("leaving")).toBe(false); // standing still while it speaks
    vi.advanceTimersByTime(1300);
    expect(chip.querySelector(".say")).toBeNull();
    expect(chip.classList.contains("leaving")).toBe(true);
    expect(chip.style.left).toBe("100%");
    expect(strip.hidden).toBe(false); // still on its way out
    finish(chip);
    expect(strip.querySelectorAll(".staff")).toHaveLength(0);
    expect(strip.hidden).toBe(true);
    strip.remove();
    vi.useRealTimers();
  });
});

describe("chat staff fun", () => {
  it("each chip has an emote puff; a click makes it hop until the animation ends", () => {
    const strip = staffStrip("s1");
    document.body.append(strip);
    refreshStaff([emp("a", "s1", "working")], () => null);
    const chip = strip.querySelector<HTMLElement>(".staff")!;
    expect(chip.querySelector(".emote")!.textContent).not.toBe("");
    chip.click();
    const tricks = ["hop", "spin", "dance", "flip", "shake", "peek"];
    const name = tricks.find((t) => chip.classList.contains(t))!;
    expect(name).toBeDefined();
    expect(chip.querySelector(".say")!.textContent).not.toBe("");
    const end = new Event("animationend");
    Object.assign(end, { animationName: name });
    chip.dispatchEvent(end);
    expect(chip.classList.contains(name)).toBe(false);
    strip.remove();
  });

  it("a new chip drops in, and a finished one throws confetti", () => {
    vi.useFakeTimers();
    const strip = staffStrip("s7");
    document.body.append(strip);
    refreshStaff([emp("a", "s7", "working")], () => null);
    const chip = strip.querySelector<HTMLElement>(".staff")!;
    expect(chip.classList.contains("arrive")).toBe(true);
    refreshStaff([emp("a", "s7", "done")], () => null);
    expect(chip.querySelectorAll(".confetti").length).toBeGreaterThan(0);
    vi.advanceTimersByTime(1500);
    expect(chip.querySelectorAll(".confetti")).toHaveLength(0);
    strip.remove();
    vi.useRealTimers();
  });

  it("now and then a chip stops walking, does something with a prop, then walks on", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const strip = staffStrip("s8");
    document.body.append(strip);
    refreshStaff([emp("a", "s8", "working")], () => null);
    const chip = strip.querySelector<HTMLElement>(".staff")!;
    expect(chip.classList.contains("busy")).toBe(false);
    vi.advanceTimersByTime(6100);
    expect(chip.classList.contains("busy")).toBe(true);
    expect(chip.querySelector(".prop")!.textContent).not.toBe("");
    vi.advanceTimersByTime(4000);
    expect(chip.classList.contains("busy")).toBe(false);
    expect(chip.querySelector(".prop")).toBeNull();
    strip.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("a chip that finishes mid-activity drops the prop and the pose", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const strip = staffStrip("s9");
    document.body.append(strip);
    refreshStaff([emp("a", "s9", "working")], () => null);
    const chip = strip.querySelector<HTMLElement>(".staff")!;
    vi.advanceTimersByTime(6100);
    refreshStaff([emp("a", "s9", "done")], () => null);
    expect(chip.classList.contains("busy")).toBe(false);
    expect(chip.querySelector(".prop")).toBeNull();
    strip.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});
