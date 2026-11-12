// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Panel } from "../src/client/panel.js";
import { confirmDialog, renderLaunchDialog, renderModelRules, showDialog, type LaunchOpts } from "../src/client/launcher.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const q = <T extends Element>(root: Element, sel: string) => root.querySelector(sel) as T;
const submit = (root: Element) => q<HTMLButtonElement>(root, "button.go").click();

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("renderLaunchDialog", () => {
  it("folder names with <b> render as text", () => {
    const d = renderLaunchDialog(["/x/<b>bold</b>"], async () => null);
    expect(d.querySelector("b")).toBeNull();
    expect(d.textContent).toContain("<b>bold</b>");
  });
  it("select value is used when path input is empty", () => {
    const onSubmit = vi.fn(async (_o: LaunchOpts) => null);
    const d = renderLaunchDialog(["/a", "/b"], onSubmit);
    q<HTMLSelectElement>(d, "select.folder").value = "/b";
    submit(d);
    expect(onSubmit).toHaveBeenCalledWith({ cwd: "/b" });
  });
  it("typed path wins over select", () => {
    const onSubmit = vi.fn(async (_o: LaunchOpts) => null);
    const d = renderLaunchDialog(["/a"], onSubmit);
    q<HTMLInputElement>(d, "input.path").value = "C:\\typed";
    submit(d);
    expect(onSubmit.mock.calls[0][0].cwd).toBe("C:\\typed");
  });
  it("empty selects omit model/subagentModel; chosen ones map to aliases", async () => {
    const onSubmit = vi.fn(async (_o: LaunchOpts) => null);
    let d = renderLaunchDialog(["/a"], onSubmit);
    submit(d);
    expect(onSubmit.mock.calls[0][0]).toEqual({ cwd: "/a" });
    const d2 = renderLaunchDialog(["/a"], onSubmit);
    d = d2;
    q<HTMLSelectElement>(d, "select.model").value = "opus";
    q<HTMLSelectElement>(d, "select.sub").value = "haiku";
    q<HTMLTextAreaElement>(d, "textarea").value = "hi";
    submit(d);
    expect(onSubmit.mock.calls[1][0]).toEqual({ cwd: "/a", model: "opus", subagentModel: "haiku", prompt: "hi" });
  });
  it("model labels and prompt maxlength", () => {
    const d = renderLaunchDialog([], async () => null);
    const labels = [...d.querySelectorAll("select.model option")].map((o) => o.textContent);
    expect(labels).toEqual(["Mặc định", "Opus", "Sonnet", "Haiku", "Fable"]);
    expect([...d.querySelectorAll("select.sub option")].map((o) => o.textContent)).toEqual(["Không đặt", "Haiku", "Sonnet", "Opus"]);
    expect(q(d, "textarea").getAttribute("maxlength")).toBe("4000");
  });
  it("shows server error text", async () => {
    const d = renderLaunchDialog(["/a"], async () => "Thư mục không tồn tại");
    submit(d);
    await tick();
    expect(q(d, ".msg").textContent).toBe("Thư mục không tồn tại");
    expect(q<HTMLButtonElement>(d, "button.go").disabled).toBe(false);
  });
  it("disables submit while in flight", async () => {
    let done!: (v: null) => void;
    const onSubmit = vi.fn(() => new Promise<null>((r) => (done = r)));
    const d = renderLaunchDialog(["/a"], onSubmit);
    submit(d);
    expect(q<HTMLButtonElement>(d, "button.go").disabled).toBe(true);
    submit(d);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    done(null);
    await tick();
  });
  it("success message then closes after 1.5s", async () => {
    vi.useFakeTimers();
    const d = renderLaunchDialog(["/a"], async () => null);
    showDialog(d);
    submit(d);
    await vi.advanceTimersByTimeAsync(0);
    expect(q(d, ".msg").textContent).toBe("Đã mở terminal");
    expect(document.body.contains(d)).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.body.contains(d)).toBe(false);
  });
});

describe("dialog chrome", () => {
  it("Esc with a dialog open closes only the dialog, not the panel behind it", async () => {
    const root = document.createElement("div");
    const p = new Panel(root, vi.fn().mockResolvedValue({ id: "s1", staff: [], steps: [], chat: [], employees: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byModel: {} } }) as never);
    await p.open("session", "s1");
    showDialog(renderLaunchDialog([], async () => null));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelectorAll(".dialog").length).toBe(0);
    expect(root.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.hidden).toBe(true);
  });
  it("Esc, close button and backdrop close; one at a time", () => {
    const a = renderLaunchDialog([], async () => null);
    showDialog(a);
    const b = renderModelRules("off", async () => "off");
    showDialog(b);
    expect(document.body.contains(a)).toBe(false);
    expect(document.querySelectorAll(".dialog").length).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelectorAll(".dialog").length).toBe(0);
    showDialog(a);
    q<HTMLButtonElement>(a, "button.close").click();
    expect(document.querySelectorAll(".dialog").length).toBe(0);
    showDialog(a);
    a.click(); // backdrop is the root itself
    expect(document.querySelectorAll(".dialog").length).toBe(0);
    showDialog(a);
    q<HTMLElement>(a, ".box").click();
    expect(document.querySelectorAll(".dialog").length).toBe(1);
  });
});

describe("renderModelRules", () => {
  it("user state disables checkbox and explains", () => {
    const d = renderModelRules("user", async () => "user");
    expect(q<HTMLInputElement>(d, "input[type=checkbox]").disabled).toBe(true);
    expect(q(d, ".msg").textContent).toContain("Explore.md");
    expect(d.textContent).toContain("Explore dùng Haiku");
    expect(d.textContent).toContain("Áp dụng cho phiên mở sau khi bật; phiên đang chạy dùng cấu hình cũ.");
  });
  it("toggle calls onToggle(true) and shows new state", async () => {
    const onToggle = vi.fn(async () => "on" as const);
    const d = renderModelRules("off", onToggle);
    const cb = q<HTMLInputElement>(d, "input[type=checkbox]");
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    expect(cb.disabled).toBe(true);
    await tick();
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(cb.checked).toBe(true);
    expect(cb.disabled).toBe(false);
    expect(q(d, ".msg").textContent).toBe("Đang bật");
  });
  it("toggle error reverts checkbox and shows message", async () => {
    const d = renderModelRules("off", async () => "Không ghi được Explore.md");
    const cb = q<HTMLInputElement>(d, "input[type=checkbox]");
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    await tick();
    expect(cb.checked).toBe(false);
    expect(q(d, ".msg").textContent).toBe("Không ghi được Explore.md");
  });
});

describe("launch preset", () => {
  it("preselects preset and adds it when missing", () => {
    const d = renderLaunchDialog(["/a", "/b"], async () => null, "/b");
    expect(q<HTMLSelectElement>(d, "select.folder").value).toBe("/b");
    const e = renderLaunchDialog(["/a"], async () => null, "/z");
    expect(q<HTMLSelectElement>(e, "select.folder").value).toBe("/z");
    expect(e.querySelectorAll("select.folder option").length).toBe(2);
  });
});

describe("confirmDialog", () => {
  const btn = (t: string) => [...document.querySelectorAll<HTMLButtonElement>(".dialog button")].find((b) => b.textContent === t)!;
  afterEach(() => document.querySelectorAll(".dialog").forEach((d) => d.remove()));
  it("ok resolves true", async () => {
    const p = confirmDialog("x", "Vẫn mở", "Huỷ");
    btn("Vẫn mở").click();
    expect(await p).toBe(true);
  });
  it("cancel and ✕ resolve false", async () => {
    let p = confirmDialog("x", "Vẫn mở", "Huỷ");
    btn("Huỷ").click();
    expect(await p).toBe(false);
    p = confirmDialog("x", "Vẫn mở", "Huỷ");
    btn("✕").click();
    expect(await p).toBe(false);
  });
});
