// @vitest-environment happy-dom
import { Container } from "pixi.js";
import { expect, it } from "vitest";
import { fireworks } from "../src/client/party.js";

it("fireworks add one overlay to the parent that never takes clicks", () => {
  const parent = new Container();
  fireworks(parent, { x: 10, y: 10 }, () => 0.5);
  expect(parent.children).toHaveLength(1);
  expect(parent.children[0].eventMode).toBe("none");
});
