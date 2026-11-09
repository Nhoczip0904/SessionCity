# BackendCity Part 3 — rulings and deferred follow-ups

Recorded during subagent-driven execution of docs/superpowers/plans/2026-11-09-backendcity-part3.md. Manual test: docs/superpowers/part3-manual-test.md

## Rulings
- Ruling: cmd.exe fallback (no wt) omits the prompt and buildLaunch throws when cwd/claude/settings path contains cmd metacharacters (& | < > ^ % ! ( ) ") — cmd re-parses its command line even with shell:false, so passing user text would be command injection; wt is installed on this machine so the primary path keeps prompts — cost if wrong: users without wt can't pass a prompt / paths with "(" fail in fallback
- Ruling: Task 3 maps a buildLaunch throw to 400 {"error": …} (plan said Task 2; the route lives in Task 3) — cost if wrong: none
- Ruling: wt never receives user text — wt runs `<node> <pkgroot>/bin/claude-launch.mjs <jobFile>`; jobFile = random 0o600 temp JSON {claude, model?, settingsFile?, prompt?} written with flag wx; the launcher reads+deletes it, spawns claude.exe with [flags…, "--", prompt] (shell:false, stdio inherit), deletes the settings file when claude exits, exits with claude's code. Replaces spec §4.3's direct `wt … claude --model … -- <prompt>` argv — spec intent (no injection, prompt intact) needs it; reviewer showed the direct form is injectable/lossy — cost if wrong: one extra node process per session
- Ruling: claude must resolve to a .exe (findOnPath restricted to .exe for claude); buildLaunch/launch throw otherwise — cost if wrong: npm-only installs without claude.exe get "chưa cài" instead of running
- Final: Ruling: accepted-and-closed per final review — cmd fallback refuses ( ) paths; TOCTOU in agents; untested failure cleanup; server-side metachar → 400; no own slowloris timeout; aborted body unanswered; unreachable rejecting launcher; state undefined render — cost if wrong: edge-case UX only

## Deferred minors
- Task 1: minor (deferred): trailing spaces/dots in cwd pass validation
- Task 1: minor (deferred, defence in depth): runJob doesn't type-check model/prompt or confine settingsFile to tmpdir backendcity-*.json (tampered job could delete a user file; needs same-user write access); spawn sync throw → unhandled rejection
- Task 1: minor (deferred): server 10-min timer deletes settings while claude may run (redundant); launcher doesn't ignore SIGINT; cmd fallback refuses paths with ( ) e.g. Program Files (x86)
- Task 2: minor (deferred): MARKER matched anywhere (not line-anchored); TOCTOU check→rename/unlink; EEXIST temp cleanup could unlink a colliding file; untested failure-path cleanup / Explore.md as directory
- Task 3: minor (deferred): GET explore read error says "Không ghi được"; server-side path metachar in fallback → 400 not 500; no own slowloris timeout (Node defaults); aborted body unanswered; unreachable rejecting launcher when claude missing
- Task 4: minor (deferred): Esc with dialog open also closes the panel behind; launcher test uses "C:\typed" (tab); state undefined renders "undefined" if server breaks contract
- Final: minor (deferred): invalid model/prompt in a job leaves a valid settings file in TEMP; launcher tmpdir check could reject if wt window has a different TEMP; partial wx write could leave Explore.md.tmp-*
