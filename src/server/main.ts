import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./http.js";
import { findOnPath, launch, type LaunchOpts } from "./launch.js";
import { Store } from "./store.js";
import { loadConfigRules, packageRoot, Watcher } from "./watch.js";

const i = process.argv.indexOf("--port");
const port = i >= 0 ? Number(process.argv[i + 1]) : 4317;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("invalid --port");
  process.exit(1);
}

let rules;
try {
  rules = loadConfigRules();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const store = new Store();
const watcher = new Watcher(join(homedir(), ".claude", "projects"), (events) => { events.forEach((e) => store.apply(e)); store.tick(); }, { rules });
const clientDir = join(packageRoot(), "dist", "client");
const claude = findOnPath("claude", [join(homedir(), ".local", "bin", "claude.exe")], undefined, undefined, [".exe"]);
const wt = findOnPath("wt", [], undefined, undefined, [".exe"]);
const agentsDir = join(homedir(), ".claude", "agents");
const launcher = claude
  ? (opts: LaunchOpts) => launch(opts, { claude, wt, spawn, tmpDir: tmpdir(), setTimeout })
  : () => Promise.reject(new Error("claude not found"));
// claude hands the session to the Desktop app and exits; no terminal window
const openDesktop = (id: string, cwd: string | undefined) =>
  new Promise<void>((ok, fail) => {
    if (!claude) return fail(new Error("claude not found"));
    const child = spawn(claude, ["--desktop", "--resume", id], { cwd: cwd ?? homedir(), detached: true, stdio: "ignore", shell: false, windowsHide: true });
    child.once("error", fail);
    child.once("spawn", () => { child.unref(); ok(); });
  });
const server = await startServer({ port, token: randomBytes(16).toString("hex"), store, clientDir, claude, agentsDir, claudeDir: join(homedir(), ".claude"), launcher, openDesktop });
await watcher.start();
console.log(server.url);
if (!claude) console.error("Chưa tìm thấy claude.exe — nút Mở phiên sẽ báo lỗi (cài: winget install Anthropic.ClaudeCode)");
if (!existsSync(clientDir)) console.error("dist/client not found: run `npm run build` for the UI (API still works).");

process.on("SIGINT", () => {
  watcher.stop();
  void server.close().then(() => process.exit(0));
});
