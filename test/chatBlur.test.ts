// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { BLUR_DEFAULT, BLUR_MAX, applyBlur, blurSlider, loadBlur } from "../src/client/chatBlur.js";

const cssVar = () => document.documentElement.style.getPropertyValue("--chat-blur");

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--chat-blur");
});

describe("chat blur", () => {
  it("starts at the default, and ignores junk or out-of-range saved values", () => {
    expect(loadBlur()).toBe(BLUR_DEFAULT);
    localStorage.setItem("city.chatBlur", "nope");
    expect(loadBlur()).toBe(BLUR_DEFAULT);
    localStorage.setItem("city.chatBlur", "999");
    expect(loadBlur()).toBe(BLUR_MAX);
    localStorage.setItem("city.chatBlur", "-5");
    expect(loadBlur()).toBe(0);
  });
  it("applyBlur sets the page-wide css variable and remembers it", () => {
    applyBlur(9);
    expect(cssVar()).toBe("9px");
    expect(loadBlur()).toBe(9);
  });
  it("the slider shows the saved value and moving it applies the blur", () => {
    localStorage.setItem("city.chatBlur", "6");
    const s = blurSlider();
    expect(s.type).toBe("range");
    expect(s.max).toBe(String(BLUR_MAX));
    expect(s.value).toBe("6");
    s.value = "20";
    s.dispatchEvent(new Event("input"));
    expect(cssVar()).toBe("20px");
    expect(localStorage.getItem("city.chatBlur")).toBe("20");
  });
  it("a second slider follows the first", () => {
    const a = blurSlider(), b = blurSlider();
    document.body.append(a, b); // sliders no longer on the page are forgotten
    a.value = "3";
    a.dispatchEvent(new Event("input"));
    expect(b.value).toBe("3");
  });
});
