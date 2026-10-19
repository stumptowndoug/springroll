# Springroll

The shell the owner sees: a home screen of Views, tabs, and the agent's
terminal beside them. Served at the machine's Tailscale address via
`tailscale serve` → 127.0.0.1:8000.

- `server.mjs`: Node, no dependencies. Lists `views/*`, proxies `/v/<name>/`
  to each View's `PORT` (or serves it statically), proxies `/term/` to ttyd,
  and handles `/api/show`, `/api/notify`, `/api/focus` (writes `~/.desk/focus`),
  `/api/events` (server-sent events to open Desks).
- Page code (`public/`: `index.html`, `app/`, `ui/`) is served as committed on
  this repo's HEAD, exported to `~/.desk/live/<tree>` and checked every 2s; open
  tabs get a `build` event when it changes and reload when the owner looks away.
  A half-done edit never reaches the screen; a commit (a `change merge`) does.
  `ui/custom.css` (the owner's overrides) is always served from the folder.
- A copy for work on Springroll itself (`bin/change up`) runs this server from a
  worktree with `SPRINGROLL_COPY=1` (serve the files as they are),
  `SPRINGROLL_REPO` (its views, agents.json), `SPRINGROLL_PORT`,
  `SPRINGROLL_SETTINGS` (its own copy of desk.json) and `SPRINGROLL_AGENTD_PORT`.
- `usage.mjs`: `GET /api/usage` → visible, installed, signed-in providers with
  `{id, name, plan, windows[{key, label, used, resetsAt, windowMs}], error,
  fix, updated, nextCheck}`. Percentages are used quota; times are Unix ms.
  The sidebar shows Claude, Codex and Antigravity quota windows with reset
  times and pace. Antigravity uses the existing agy sign-in and the read-only
  `agy -p /usage --output-format json --print-timeout 30s` command, gated to
  agy ≥1.1.11 so older versions cannot treat it as a model prompt. Gemini and
  Claude/GPT each have weekly and 5-hour pools; missing or disabled buckets
  are omitted. Settings → Utilization independently shows Claude, Codex,
  Antigravity Gemini and Antigravity Claude/GPT. The first three default to on;
  Antigravity Claude/GPT defaults to off. Visibility is stored in `desk.json`
  as `utilization: {claude, codex, antigravityGemini, antigravityThirdParty}`.
  `POST /api/settings {utilization: {codex: false}}` changes one switch,
  preserving the others; only known boolean values are accepted. The sidebar
  and `/api/usage` apply the same filter; the underlying cache retains every
  available quota pool. `antigravity-usage.mjs` bounds the usage command to 40 seconds and 1 MiB,
  runs in a temporary workspace, and cleans up its process group and files.
  Quotas are cached for five minutes; failures retain the last good numbers
  and back off. State lives in `~/data/desk/usage.json`, migrated from
  `~/.desk/usage.json` without losing existing quotas or retry deadlines.
  Check with `node --test views/desk/test/*.test.mjs`.
- `needs.mjs`: the Timeline's Needs you, read by a model. `GET /api/needs`
  (`?opened=1` may start a read) → `{items[{id, kind act|watch, priority, title,
  insight, refs, sources[{ref, label, src, href, icon, signal?}], action{label,
  ask}, vote}], generated, took, agent, model, generating, error}`;
  `POST /api/needs/refresh`, `POST /api/needs/<id>/done|up|down`,
  `GET|POST /api/needs/preferences {text}`, `GET|POST /api/needs/config {agent,
  model, effort, cadence: live|hourly|manual, starter}` (Settings → Needs you;
  `starter`: Chat on an item opens with its suggested step typed in). A read is
  one agentd session (origin `needs`, never listed, deleted once read), so any
  agent that can chat works with any of its models. A `needs` event on
  `/api/events` when a read starts or ends. Data in `~/data/desk/needs/`
  (`config.json` also has `owner`: the owner's name, so mail they send
  themselves isn't someone waiting on them).
- `public/index.html`: the whole UI.
- `desk.service`, `desk-term.service`: systemd user units. The terminal runs
  `bin/agent-session` (tmux session `agent` running Claude Code).

Restart after changes: `systemctl --user restart desk`. Restarting
`desk-term` doesn't kill the agent's tmux session.
