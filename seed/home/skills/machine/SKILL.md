---
name: machine
description: Keeping this machine healthy and current - the System app's watchdog and what you may stop or restart when memory, CPU or disk run short, the nightly housekeeping job, backups and restores, Springroll updates from upstream, and when to move heavy work to a Sprite. Use when the machine is short on resources, when you're the watchdog's agent, or for questions about backups, updates or housekeeping.
---

# Keeping the machine well

## Machine health

The System app (`views/system/`) watches memory, CPU and disk and shows what's using them: chats,
terminal sessions, apps, other processes. When memory stays above its limit (or disk fills), its
watchdog notifies the owner and may run an agent headless with the details. If that's you:

- You may pause, restart or stop apps' services, background jobs, and processes an agent started,
  and clear caches that can be rebuilt:
  `curl -s -X POST localhost:8102/api/act -d '{"kind": "service", "id": "mail.service", "action": "restart"}'`
  (kinds: service, chat, session, process; actions: pause, resume, restart, stop).
- Don't stop the owner's chats or terminal sessions, or Springroll (`desk`, `desk-term`, `agentd`,
  `system`); recommend it instead.
- Fix the cause where you can and say what you changed, briefly.

The nightly **housekeeping** job (`jobs/housekeeping`) does the routine part every night: stops
chats idle for 12+ hours and stray processes agents left behind, clears rebuildable caches and old
temp files, tidies abandoned changes to Springroll (`change tidy`), checks the skills and what every chat loads (`jobs/housekeeping/skills-check.sh`; a fuller read on Sundays), and reports trends. Machine-specific exceptions (long-running work to leave alone) go
in the "This machine" section of its `NOTES.md`.

## Heavy work

This machine is meant to stay small. Work that needs lots of memory or CPU or runs for hours (batch
jobs, big builds, many browsers) goes to a **Sprite** (a cloud computer per project) when the owner
has connected Fly Sprites: follow `skills/sprites/SKILL.md`. Note in `LOCAL.md` which projects live
on which Sprite.

## Backups

`backup` writes one file to `~/backups/` with `~/home` (full git history), `~/data` (SQLite copied
safely), and, encrypted with the owner's passphrase, secrets and sign-ins. A nightly job keeps the
last 7. `install.sh --restore <file>` rebuilds a new machine from one. So: keep state in `~/home` or
`~/data`, and give anything new a place there.

Off-machine backups are opt-in: once the owner connects a bucket (GCS, S3, R2, B2, Azure), each
backup also goes there through restic, encrypted with the same passphrase (`backup offsite`,
`restore --offsite <repo>`). The weekly **backup-check** job test-restores both. Setting it up,
keys and recovery: `skills/backup/SKILL.md`.

## Updates

This machine is the owner's own version of Springroll: change anything (the app, the kit, the
rules) when they ask. Upstream Springroll keeps improving, and you keep this machine current by
merging it with judgment: the weekly **Update Springroll** job (`jobs/springroll-update`) follows
`skills/update/SKILL.md`. `springroll-upstream` shows what's new; `CHANGELOG.md` explains it.

When you change Springroll itself (not an app or job of the owner's), add a line to `LOCAL.md`:
what and why. That's how updates know to keep it.
