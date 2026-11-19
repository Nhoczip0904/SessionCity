// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHud } from "../src/client/hud.js";

describe("HUD buttons", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="btn-launch"></button><button id="btn-summary"></button><button id="btn-rules"></button><button id="btn-rock"></button><button id="btn-grab"></button><button id="btn-bolt">⚡ Sét đánh</button><button id="btn-meteor"></button><button id="btn-sniper"></button><button id="btn-laser"></button><button id="btn-sandbox"></button><details id="toys"><summary id="toys-sum">T</summary></details><b id="n-done"></b>
      <button id="btn-agents" aria-pressed="true"></button><nav id="agents"></nav>`;
  });
  const hud = (agentsOn = true) => {
    const on = { launch: vi.fn(), summary: vi.fn(), rules: vi.fn(), rock: vi.fn(), grab: vi.fn(), bolt: vi.fn(), meteor: vi.fn(), sniper: vi.fn(), laser: vi.fn(), sandbox: vi.fn(), sbx: vi.fn(), agents: vi.fn() };
    createHud(on, agentsOn);
    return on;
  };
  const $ = (id: string) => document.getElementById(id)!;

  it("rock and throw are exclusive tools: arming one puts the other down", () => {
    const on = hud();
    $("btn-rock").click();
    $("btn-grab").click();
    expect($("btn-rock").getAttribute("aria-pressed")).toBe("false");
    expect($("btn-grab").getAttribute("aria-pressed")).toBe("true");
    expect(on.rock).toHaveBeenLastCalledWith(false);
    expect(on.grab).toHaveBeenLastCalledWith(true);
    $("btn-grab").click();
    expect(on.grab).toHaveBeenLastCalledWith(false);
    expect(on.rock).toHaveBeenCalledTimes(2); // not told again
  });

  it("lightning is a third exclusive tool, and the drop-down closes once one is chosen", () => {
    const on = hud();
    ($("toys") as HTMLDetailsElement).open = true;
    $("btn-rock").click();
    $("btn-bolt").click();
    expect($("btn-rock").getAttribute("aria-pressed")).toBe("false");
    expect(on.bolt).toHaveBeenLastCalledWith(true);
    expect(on.rock).toHaveBeenLastCalledWith(false);
    expect(($("toys") as HTMLDetailsElement).open).toBe(false);
    expect($("toys-sum").textContent).toContain("Sét");
  });

  it("shows the finished-today count", () => {
    const h = createHud({ launch: vi.fn(), summary: vi.fn(), rules: vi.fn(), rock: vi.fn(), grab: vi.fn(), bolt: vi.fn(), meteor: vi.fn(), sniper: vi.fn(), laser: vi.fn(), sandbox: vi.fn(), sbx: vi.fn(), agents: vi.fn() }, true);
    h.setDone(7);
    expect($("n-done").textContent).toBe("7");
  });

  it("the summary button calls its handler", () => {
    const on = hud();
    $("btn-summary").click();
    expect(on.summary).toHaveBeenCalledTimes(1);
  });

  it("the agent index button hides and shows the left column, starting from the saved state", () => {
    const on = hud(false);
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
