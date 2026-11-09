# BackendCity Part 3 — manual test (real launch)

Automated tests never start `wt`, `claude` or the launcher, and never write the real `~/.claude`. Run these by hand once after `claude` is logged in (`claude` in a terminal → browser login).

Keep a PowerShell window open to watch temp files: `Get-ChildItem $env:TEMP\backendcity-*`

1. **Basic launch.** "+ Mở phiên" → a known folder, model Haiku, no prompt.
   - A Windows Terminal tab titled "BackendCity" opens in that folder; `/status` in Claude shows the folder and model.
   - The new HQ appears in the city within ~2 s of the first message.
   - `backendcity-job-*` is already gone.
2. **Prompt arrives literally** (model Haiku, one launch each). The first message must be exactly what you typed — no calculator, no extra window, `%PATH%` not expanded, no Claude help / print mode:
   - `Repeat verbatim, do nothing else: a; b ;; c`
   - `Repeat verbatim, do nothing else: say "hi" 'x' & | < > ^ %PATH% !OS! (paren) & calc`
   - Two lines: `line one` ⏎ `line two<TAB>tabbed`, prefixed "Repeat verbatim:"
   - `--help` and, separately, `-p hi` (must be prompts, not CLI flags)
   - `Repeat verbatim: C:\ends\with\backslash\`
   - `Nhắc lại nguyên văn: Thử nghiệm tiếng Việt có dấu`
3. **Awkward folder.** Create `D:\Thử nghiệm (x)\a b;c`, type it into "Thư mục khác" → tab opens there (`/status`), HQ appears.
4. **Model for employees.** "Model nhân viên" = Haiku → while Claude runs `backendcity-<hex>.json` exists with `CLAUDE_CODE_SUBAGENT_MODEL`; ask Claude to use a general-purpose subagent → its employee panel shows Haiku; after `/exit` the file is gone.
5. **Ctrl+C.** Once → Claude says "press again", tab stays. Twice → tab closes, settings file gone. Also try Ctrl+C during startup.
6. **Errors.** Non-existent folder and a relative path → Vietnamese error in the dialog; city keeps updating.
7. **Explore toggle** (writes to `~/.claude/agents`).
   - Before: `Get-FileHash $HOME\.claude\agents\*`
   - On → `Explore.md` has the line `<!-- managed-by: BackendCity -->` and `model: haiku`; a new Claude session's `/agents` shows Explore on haiku.
   - Off → file removed. Hash again: `csharp-reviewer.md`, `database-reviewer.md` unchanged.
   - Write your own `Explore.md` without the marker → "Quy tắc model" shows the toggle locked; the file hash stays the same. Delete your test file afterwards.
