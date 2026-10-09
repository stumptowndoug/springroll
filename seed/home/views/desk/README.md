# Springroll

The shell the owner sees: a home screen of Views, tabs, and the agent's
terminal beside them. Served at https://springroll.tail07853f.ts.net via
`tailscale serve` → 127.0.0.1:8000.

- `server.mjs`: Node, no dependencies. Lists `views/*`, proxies `/v/<name>/`
  to each View's `PORT` (or serves it statically), proxies `/term/` to ttyd,
  and handles `/api/show`, `/api/notify`, `/api/focus` (writes `~/.desk/focus`),
  `/api/events` (server-sent events to open Desks).
- `public/index.html`: the whole UI.
- `desk.service`, `desk-term.service`: systemd user units. The terminal runs
  `bin/agent-session` (tmux session `agent` running Claude Code).

Restart after changes: `systemctl --user restart desk`. Restarting
`desk-term` doesn't kill the agent's tmux session.
