# Nightly housekeeping

Springroll keeps chats' agents running between messages, so a chat can supervise long work. That
means nothing stops forgotten work on its own: this job is the machine's nightly tidy-up. Look,
clean up what's clearly pointless, and report in a few lines. When in doubt, leave it and mention it.

## Look at

- **Memory, CPU, disk**: `curl -s localhost:8102/api/now` (groups: chats, sessions, services,
  other) and `curl -s 'localhost:8102/api/history?hours=24'`. Note anything that grows steadily
  (a leak) or sits high, and what it is.
- **Idle chats**: a chat's agent with no turn for **12+ hours** that isn't watching anything (no
  child processes doing work, and its last messages don't say it's supervising something:
  `curl -s localhost:8090/threads/<thread>`) is abandoned. Stop it by its **scope ID**, the
  `id` of its entry in `/api/now`'s chats group (`agentd-<thread>-….scope`), not the thread ID
  (that's the entry's `thread` field):
  `curl -s -X POST localhost:8102/api/act -d '{"kind":"chat","id":"<scope id>","action":"stop"}'`.
  That only ends the process; the chat picks up again on its next message. Never stop a chat
  that is mid-turn or supervising work (check its Background: `GET localhost:8090/threads/<thread>/background`).
- **Services**: `systemctl --user --failed`, errors and restart loops
  (`journalctl --user -p err --since -24h`). Restart a failed app service once if the cause is
  transient; otherwise report it. Apps unused for weeks: just mention them.
- **Stray processes** an agent started and left behind: dev servers, headless browsers, `sleep` or
  `tail -f` loops, orphaned Python/Node. Only stop a process inside an agent's scope
  (`systemctl --user status <pid>` / `/proc/<pid>/cgroup` shows `agentd-….scope`) whose chat is
  gone or idle, or one left by a job run that has finished; System's `process` kind. Anything
  outside those (system services, the owner's terminal sessions, the owner's own long-running units)
  or that you can't attribute: leave it and mention it.
- **Disk**: agents' temp files in `/tmp` older than 2 days that nothing has open (check with
  `fuser`/`lsof +D` first; skip sockets, lock files and anything a running process holds), old Playwright browser versions in
  `~/.cache/ms-playwright`, `uv cache prune`, `npm cache verify`, old journal logs
  (`journalctl --user --vacuum-time=30d`). Say what it freed.
- **Jobs**: ones that keep failing or keep getting slower (`curl -s localhost:8090/jobs`).
- **Backups**: the newest file in `~/backups/` should be under ~26 hours old (the `nightly-backup`
  job). Older, missing or suspiciously small vs the previous one: `signal --needs`.
- **Watchdog incidents**: `curl -s localhost:8102/api/watch` lists the System watchdog's incidents
  (`~/data/system/incidents/`). New ones since the last run: say what tripped it and whether it
  recurs (same service, same hour).

- **Skills** (`~/home/skills/`, plus `AGENTS.md` and `notes/memory.md`, which every chat loads):
  run `~/home/jobs/housekeeping/skills-check.sh`. It prints one line per skill (size, frontmatter,
  linked into Claude/Codex/Pi, chats that read it in 30 days, paths it names that are gone) and the
  size of what every chat loads. Flag: a missing link or bad frontmatter, a named path that's really
  gone (not one the skill says to avoid), AGENTS.md over ~6 KB or memory.md over ~80 lines, a
  skill over ~10 KB. On **Sundays** also read each skill properly: is it still true of the code it
  describes (commands, fields, endpoints: spot-check `bin/`, `agentd/`, `views/desk/`), does it
  repeat AGENTS.md or another skill, has it grown with detail nobody needs, has nothing read it in
  30 days (a candidate to merge or drop)? You don't edit skills: put the proposed changes in one
  `signal --needs --key housekeeping:skills` with the exact edits in `--note`, so Chat can apply
  them. Nothing wrong: one line in the report, no signal.

Never touch `~/home`, `~/data`, `~/projects`, `~/backups` or `~/.config`. Never stop Springroll
(`desk`, `desk-term`, `agentd`, `system`), the owner's terminal sessions, a job's own running work,
or anything listed under **This machine** below.

## Report

Your final message is the report: one line on the machine's health, then what you stopped or
cleaned (and what it freed), then anything the owner should know. Something that needs the owner:
`signal --needs` (source "Housekeeping"); a slow trend worth knowing: a plain `signal`.

## This machine

What's normal here, recurring offenders, and long-running work never to stop. Keep it short.

- `uv cache prune` can hang on the cache lock: run it with `timeout 60`, skip if it stalls. Don't `pkill -f` a pattern that appears in your own command line.
- skills-check: the web skill names `~/.agent-browser/config.json` only to say never create it;
  "missing" there is expected.
- Backup runs at 03:30, so at this job's 02:30 the newest backup is ~15h old: normal.
