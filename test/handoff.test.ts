import { describe, expect, it } from "vitest";
import { handoffs } from "../src/client/handoff.js";

describe("handoffs", () => {
  it("first look animates nothing", () => {
    expect(handoffs(null, [{ id: "a", done: false }])).toEqual([]);
  });
  it("a new working employee is an assignment", () => {
    expect(handoffs(new Map(), [{ id: "a", done: false }])).toEqual([{ kind: "assign", id: "a" }]);
  });
  it("working → done is a report; already done or unchanged is nothing", () => {
    const prev = new Map([["a", false], ["b", true], ["c", false]]);
    expect(handoffs(prev, [{ id: "a", done: true }, { id: "b", done: true }, { id: "c", done: false }])).toEqual([{ kind: "report", id: "a" }]);
  });
  it("an employee first seen already done is not animated", () => {
    expect(handoffs(new Map(), [{ id: "a", done: true }])).toEqual([]);
  });
});
