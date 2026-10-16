---
name: jobs
description: How scheduled work runs on this machine (~/home/jobs/<name>/ with job.json and NOTES.md, run by agentd): every job.json field (schedule, type, onlyIf, keep, group, timeline, timeout, retries, model, effort, persona), the run queue, failed runs, and the jobs API. Use when creating or changing a job, or when you're running as one.
---

# Jobs

A job is work on a schedule: a folder `~/home/jobs/<name>/` with `job.json` and `NOTES.md`. agentd
runs it; each run is a thread the owner can open, and its report is what the owner reads (and gets
on their phone).

    { "title": "Morning brief", "type": "agent", "schedule": "0 7 * * 1-5",
      "agent": "claude", "model": "sonnet", "effort": "low", "cwd": "~/home",
      "prompt": "…", "enabled": true, "catchUp": "skip", "notify": true }

- `schedule`: five-field cron in local time (omit for manual-only).
- `type: "command"` runs `command` with bash instead of an agent (notifies only on failure).
- `onlyIf` (optional): a quick shell check run before each scheduled run; if it fails, the run is
  skipped (no agent, nothing in Runs). Use it for frequent schedules that usually have nothing to do
  (`jobs/mail-triage` checks for unsorted mail).
- `keep: "failures"` (command jobs): a good run is counted but not kept as a chat; for syncs that
  run every few minutes.
- `group` ("Mail", "Monitoring"): the section it's listed under on Jobs.
- `timeline` ("failures" or "never"): which runs the Timeline lists; every run unless set. Failures
  still go under "Needs you" either way, and every run stays on the job's page. The owner's rule: a
  job whose report they read (a digest, a weekly summary) shows every run; everything else (syncs,
  triage, backups, housekeeping) gets `"failures"`. Set it when you create one.
- `timeout` ("30m", "2h"): a run still going then is stopped and counts as failed. Off unless set.
- `retries` (1-3) and `retryDelay` ("5m", the default): try a failed run again (also one cut off by
  a restart). Off unless set: only for work that's safe to repeat (a sync, a check), never for
  anything that sends or pays.
- `model` and `effort` (thinking) are optional (the agent's default); pick a small, quick one for
  sorting and summarizing, a big one for real work. The ids are whatever the agent offers:
  `curl -s localhost:8090/agents/<agent>/options`.
- `persona` (optional): how the run's agent talks (`~/home/personas/`); jobs speak plainly unless
  set.
- Missed runs (machine off) are skipped unless `catchUp: "once"`. A job never overlaps itself. At
  most 2 agent runs go at once (`SPRINGROLL_MAX_AGENT_JOBS`); more wait as "queued" (command jobs
  aren't counted). The queue is the `runs` table, so queued runs and retries survive restarts.

Create or change jobs by writing the files (then commit), or through the API:
`POST localhost:8090/jobs`, `PATCH /jobs/<name>`, `POST /jobs/<name>/run`.

## When you run as a job

- Read `NOTES.md` first (it's your memory between runs: background, not answers to copy) and update
  it with lasting patterns, not a log of each run; keep it short and merge what repeats.
- The owner sees only your **report**, not the prompt or your steps: publish it with `report`,
  written as `skills/report/SKILL.md` says. Without one, your final message is the report.
- A run that ends with a question puts it on the Timeline under "Needs you"; the owner can answer
  there. Ask only when you're truly blocked.
- A failed run (or one cut off by an agentd restart) goes under "Needs you" too; the owner can reply
  to the run's agent, run it again, or hand it to an agent. The next good run takes it off.
- A job run's agent stops 2 minutes after its turn ends unless it still has a background command,
  a timer, a subagent, or a `Monitor` before its deadline (30 minutes at most); a reply resumes it. Long work supervises itself from the one run (a ~10-minute
  status), with no extra watcher chats.

## Chats and background work

A chat's agent stays running between messages (the nightly housekeeping job stops abandoned ones),
so you can supervise long work from a chat: background commands, timers and `Monitor`s keep going
until the work is done. A background command (your shell tool's own background, never `&`/`nohup`)
is a row in the chat with live output and Stop, and in the **Background** bar above the composer
(`GET /threads/<id>/background`, `GET /threads/<id>/tasks/<task>/output`). Only Claude and Codex
report these; `Monitor`s aren't shown, and end at their deadline. An agentd restart still ends them:
for work that must be watched no matter what, also give it a job that checks on it.
