# System

Memory, CPU and disk, what's using them (by agent session, View, and other process), and a watchdog that calls an agent when the machine is running out.

- `server.py` (Python, standard library) samples every 5 seconds, keeps a
  week of per-minute history in `~/data/system/metrics.db`, and serves the
  page on port 8102.
- **Groups**: agent sessions are tmux sessions (each pane's process tree,
  summed); services are systemd user units, matched to Views by the unit files
  in `views/*/`; other is the biggest remaining processes.
- **Actions** (`POST api/act {kind, id, action}`): services can be paused
  (systemd freeze), resumed, restarted, stopped; sessions paused (SIGSTOP),
  resumed, stopped; your own processes paused, resumed, stopped. Springroll's
  own services can only be restarted.
- **Watchdog** (`watch.json`, editable in the View): memory at or above
  `memoryWarnPercent` for `memoryForSeconds`, or disk above
  `diskWarnPercent`, sends a notification and, if `agentEnabled`, runs the
  `agent` harness headless (its `headlessArgv` in `agents/agents.json`) with
  the top users and the "Machine health" policy in `skills/machine/SKILL.md`. Reports land
  in `~/data/system/incidents/`. One run per `cooldownMinutes`.
- `STATUS` makes Springroll show a memory indicator in its top bar.

API: `GET api/now` (machine + groups), `api/status`, `api/history?hours=24`,
`api/watch`; `POST api/act`, `api/watch` (config), `api/test-watchdog`.
