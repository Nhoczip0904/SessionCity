// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { picThumbs } from "../src/client/chatFooter.js";

describe("picThumbs", () => {
  it("one thumbnail per picture, built from its own base64", () => {
    const row = picThumbs([{ media_type: "image/png", data: "AAA" }, { media_type: "image/jpeg", data: "BBB" }]);
    expect(row.className).toBe("thumbs");
    expect([...row.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["data:image/png;base64,AAA", "data:image/jpeg;base64,BBB"]);
  });
});
