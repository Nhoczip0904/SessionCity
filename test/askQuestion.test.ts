// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { questionsOf, renderQuestions } from "../src/client/askQuestion.js";

const Q1 = { question: "Thanh bên thay bằng gì?", header: "Menu chat", multiSelect: false, options: [{ label: "Tab ngang", description: "Giữ nút phiên" }, { label: "Thả xuống", description: "Gọn nhất" }] };
const Q2 = { question: "Làm những phần nào?", header: "Phần", multiSelect: true, options: [{ label: "CSS", description: "" }, { label: "Test", description: "" }, { label: "Docs", description: "" }] };

const mount = (qs = [Q1]) => {
  const done = vi.fn(), skip = vi.fn();
  const card = renderQuestions(qs, done, skip);
  document.body.replaceChildren(card);
  const opts = (i: number) => Array.from(card.querySelectorAll(".aq")[i]!.querySelectorAll<HTMLButtonElement>(".aq-opt"));
  return { card, done, skip, opts, send: card.querySelector<HTMLButtonElement>(".aq-send")!, other: (i: number) => card.querySelectorAll(".aq")[i]!.querySelector<HTMLInputElement>(".aq-other")! };
};

describe("questionsOf", () => {
  it("takes a well-formed AskUserQuestion input, rejects anything else", () => {
    expect(questionsOf({ questions: [Q1] })).toHaveLength(1);
    expect(questionsOf({ questions: [] })).toBeNull();
    expect(questionsOf({ questions: [{ question: "x" }] })).toBeNull();
    expect(questionsOf({ questions: [{ question: "x", options: [{ label: 3 }] }] })).toBeNull();
    expect(questionsOf("nope")).toBeNull();
    expect(questionsOf(undefined)).toBeNull();
  });
});

describe("renderQuestions", () => {
  it("shows the header, the question and every option with its description", () => {
    const { card, opts } = mount();
    expect(card.textContent).toContain("Menu chat");
    expect(card.textContent).toContain("Thanh bên thay bằng gì?");
    expect(opts(0).map((b) => b.textContent)).toEqual([expect.stringContaining("Tab ngang"), expect.stringContaining("Thả xuống")]);
    expect(opts(0)[0]!.textContent).toContain("Giữ nút phiên");
  });
  it("Send waits for an answer, then hands back { question: label }, once", () => {
    const { opts, send, done } = mount();
    expect(send.disabled).toBe(true);
    opts(0)[1]!.click();
    expect(send.disabled).toBe(false);
    opts(0)[0]!.click(); // single choice: the last click wins
    send.click();
    send.click();
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith({ [Q1.question]: "Tab ngang" });
  });
  it("multi-select joins the picked labels in option order and lets one be unpicked", () => {
    const { opts, send, done } = mount([Q2]);
    opts(0)[2]!.click();
    opts(0)[0]!.click();
    opts(0)[1]!.click();
    opts(0)[1]!.click();
    send.click();
    expect(done).toHaveBeenCalledWith({ [Q2.question]: "CSS, Docs" });
  });
  it("a typed answer of your own counts, and replaces a picked option", () => {
    const { opts, other, send, done } = mount();
    opts(0)[0]!.click();
    other(0).value = "  Để tôi nghĩ thêm ";
    other(0).dispatchEvent(new Event("input"));
    send.click();
    expect(done).toHaveBeenCalledWith({ [Q1.question]: "Để tôi nghĩ thêm" });
  });
  it("with two questions, Send needs both", () => {
    const { opts, send } = mount([Q1, Q2]);
    opts(0)[0]!.click();
    expect(send.disabled).toBe(true);
    opts(1)[0]!.click();
    expect(send.disabled).toBe(false);
  });
  it("Skip refuses; after sending, everything locks", () => {
    const { card, skip, opts, send, done } = mount();
    card.querySelector<HTMLButtonElement>(".aq-skip")!.click();
    expect(skip).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    const again = mount();
    again.opts(0)[0]!.click();
    again.send.click();
    expect(again.opts(0).every((b) => b.disabled)).toBe(true);
    void card; void opts; void send;
  });
});
