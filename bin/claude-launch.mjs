// Fixed launcher run inside the new terminal tab. All user text arrives via a job file,
// never through wt/cmd argv, so no shell or wt parsing ever sees it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const defaults = {
  fs,
  spawn,
  exit: (c) => process.exit(c),
  err: (m) => process.stderr.write(m + "\n"),
};

const MODELS = ["opus", "sonnet", "haiku", "fable"];
const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
const settingsOk = (p) =>
  norm(path.dirname(p)) === norm(os.tmpdir()) && /^backendcity-[0-9a-f]{16}\.json$/.test(path.basename(p));

export async function runJob(jobPath, deps = defaults) {
  const d = { ...defaults, ...deps };
  const quiet = (f) => {
    try {
      f();
    } catch {
      /* already gone */
    }
  };
  let job;
  try {
    job = JSON.parse(d.fs.readFileSync(jobPath, "utf8"));
  } catch {
    d.err("Không đọc được tệp công việc SessionCity");
    return d.exit(1);
  }
  quiet(() => d.fs.unlinkSync(jobPath));
  const settingsFile = typeof job?.settingsFile === "string" ? job.settingsFile : undefined;
  const cleanup = () => settingsFile && quiet(() => d.fs.unlinkSync(settingsFile));
  const fail = (msg) => {
    d.err(msg);
    return d.exit(1);
  };
  if (typeof job?.claude !== "string" || !/\.exe$/i.test(job.claude)) {
    cleanup();
    return fail("Đường dẫn claude phải là tệp .exe");
  }
  // the job file is only a transport; re-check every field before it reaches spawn
  if (job.model != null && !MODELS.includes(job.model)) return fail("Model không hợp lệ");
  if (job.prompt != null && typeof job.prompt !== "string") return fail("Yêu cầu không hợp lệ");
  if (job.settingsFile != null && !(settingsFile && settingsOk(settingsFile))) return fail("Tệp cấu hình không hợp lệ");
  const args = [
    ...(job.model ? ["--model", job.model] : []),
    ...(settingsFile ? ["--settings", settingsFile] : []),
    ...(job.prompt ? ["--", job.prompt] : []),
  ];
  let child;
  try {
    child = d.spawn(job.claude, args, { stdio: "inherit", shell: false });
  } catch (e) {
    cleanup();
    return fail("Không chạy được claude: " + e.message);
  }
  child.once("error", (e) => {
    cleanup();
    d.err("Không chạy được claude: " + e.message);
    d.exit(1);
  });
  child.once("exit", (code) => {
    cleanup();
    d.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("SIGINT", () => {}); // Ctrl+C belongs to claude; the launcher must outlive it to clean up
  await runJob(process.argv[2]);
}
