// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHud } from "../src/client/hud.js";

describe("plaza buttons in the HUD", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="btn-launch"></button><button id="btn-rules"></button><button id="btn-rock"></button>
      <button id="btn-plaza" aria-pressed="true"></button><button id="btn-photo"></button><input id="photo-file" type="file" hidden>
      <button id="btn-agents" aria-pressed="true"></button><nav id="agents"></nav>`;
  });
  const hud = (plazaOn: boolean, agentsOn = true) => {
    const on = { launch: vi.fn(), rules: vi.fn(), rock: vi.fn(), plaza: vi.fn(), photo: vi.fn(), agents: vi.fn() };
    createHud(on, plazaOn, agentsOn);
    return on;
  };
  const $ = (id: string) => document.getElementById(id)!;

  it("starts from the saved state: off hides the photo button", () => {
    hud(false);
    expect($("btn-plaza").getAttribute("aria-pressed")).toBe("false");
    expect($("btn-photo").hidden).toBe(true);
  });

  it("toggles the plaza off and on, hiding the photo button while it is off", () => {
    const on = hud(true);
    $("btn-plaza").click();
    expect(on.plaza).toHaveBeenLastCalledWith(false);
    expect($("btn-plaza").getAttribute("aria-pressed")).toBe("false");
    expect($("btn-photo").hidden).toBe(true);
    $("btn-plaza").click();
    expect(on.plaza).toHaveBeenLastCalledWith(true);
    expect($("btn-photo").hidden).toBe(false);
  });

  it("the photo button opens the file picker; a picked file goes to the handler", () => {
    const on = hud(true);
    const input = $("photo-file") as HTMLInputElement;
    const pick = vi.spyOn(input, "click");
    $("btn-photo").click();
    expect(pick).toHaveBeenCalled();
    const file = new File(["x"], "me.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(on.photo).toHaveBeenCalledWith(file);
  });

  it("the agent index button hides and shows the left column, starting from the saved state", () => {
    const on = hud(true, false);
    expect($("agents").hidden).toBe(true);
    expect($("btn-agents").getAttribute("aria-pressed")).toBe("false");
    $("btn-agents").click();
    expect($("agents").hidden).toBe(false);
    expect(on.agents).toHaveBeenLastCalledWith(true);
    $("btn-agents").click();
    expect($("agents").hidden).toBe(true);
    expect(on.agents).toHaveBeenLastCalledWith(false);
  });
});
