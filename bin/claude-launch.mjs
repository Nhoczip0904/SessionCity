// Fixed launcher run inside the new terminal tab. All user text arrives via a job file,
// never through wt/cmd argv, so no shell or wt parsing ever sees it.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const defaults = {
  fs,
  spawn,
  exit: (c) => process.exit(c),
  err: (m) => process.stderr.write(m + "\n"),
};

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
    d.err("Không đọc được tệp công việc BackendCity");
    return d.exit(1);
  }
  quiet(() => d.fs.unlinkSync(jobPath));
  const settingsFile = typeof job?.settingsFile === "string" ? job.settingsFile : undefined;
  const cleanup = () => settingsFile && quiet(() => d.fs.unlinkSync(settingsFile));
  if (typeof job?.claude !== "string" || !/\.exe$/i.test(job.claude)) {
    cleanup();
    d.err("Đường dẫn claude phải là tệp .exe");
    return d.exit(1);
  }
  const args = [
    ...(job.model ? ["--model", job.model] : []),
    ...(settingsFile ? ["--settings", settingsFile] : []),
    ...(job.prompt ? ["--", job.prompt] : []),
  ];
  const child = d.spawn(job.claude, args, { stdio: "inherit", shell: false });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runJob(process.argv[2]);
