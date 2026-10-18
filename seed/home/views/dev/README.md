# Dev

How each project runs, what's running now, and where to open it.

## What it does

One tile per project in `~/projects` (plus any recipe for a project elsewhere): branch, uncommitted
changes, last commit, and whether its dev servers run. A project's page has:

- **Servers**: start/stop, logs, and **Open**, the private preview URL (works from the Mac or a
  phone: `https://<vm>.exe.xyz:<port>/` on exe.dev, `https://<machine>.<tailnet>.ts.net:<port>/` on
  Tailscale; `bin/preview` decides).
- **Commands**: the saved ones (setup, test, lint, check, …), run in the background, with the last
  result and output.
- **Recent changes**: uncommitted files and the last 8 commits.
- **Keys**: every key its recipe names, the variables it fills, what uses it, and whether it's in
  Keys; **Add** opens Keys with the name filled in. **Paste a .env** imports a whole file: each line
  sorted into a key (into Keys as `<keyPrefix>_DEV_<NAME>`), a setting (into the recipe's `env`) or
  skipped (what the Dev app supplies, live keys, analytics), shown for a check before anything is
  saved. The file itself is never written anywhere.
- **Database**: its dev database, a Neon branch `dev-<project>` copied from production on first
  start and reused after, with **Reset** (a fresh copy) and **Delete**.
- **Notes**: what the next agent should know (keys it lacks, what not to run).

**Ports** lists every open TCP port and who owns it: a project's dev server, an app, Springroll, or
a project's process started outside `dev` (flagged, with Chat). The sidebar chip shows "N running"
while dev servers run.

A project without a recipe shows the Makefile targets and package.json scripts it found, and
**Write a recipe** opens a chat to make one.

## Recipes

`recipes/<project>.json`; the format is in `dev help`. Rules:

- Servers bind **localhost on a port in 3000-3999**: exe.dev's proxy serves 3000-9999, and
  8000-8199 are Springroll's. Next 16 needs `-H localhost`, not `127.0.0.1`.
- Keys are named, never copied: `"secrets": {"ENV_VAR": "SECRET_NAME"}` is read from Keys when the
  server or command starts. `"secretFiles"` does the same for tools that want a credentials file
  (written to `~/.config/springroll/dev/<SECRET>`, 0600).
- No `.env` files: a key lives only in Keys, and the recipe names it (import a `.env` with Paste a
  .env or `dev env`). Settings that aren't secret go in `"env"`. `"keyNotes": {"SECRET": "what it's
  for"}` explains a key when it's missing; `"keyPrefix"` names imported keys (default: the project).
- `"database": {"neon": "<project id>", "from": "production", "env": "DATABASE_URL", "name":
  "neondb", "role": "neondb_owner"}` gives the servers (and commands with `"database": true`) the
  branch `dev-<project>`: `dev up` makes it if needed (NEON_API_KEY), and the connection string is
  fetched from Neon at each start, never stored. Only `dev-*` branches are ever made, reset or
  deleted; a default or protected branch is refused.
- Only save a server or command after running it. Say in `notes` what it lacks (keys, a database).
- Nothing that writes to a production database or deploys goes in `commands`.

## How it's built

- `devlib.py`: recipes, discovery, git, ports, and running. Servers and commands are transient
  systemd **user** units (`dev-<project>-<server>`, `dev-<project>-cmd-<command>`), started through
  `dev _exec`, which loads the env and keys and execs the command in the project. Memory limits:
  servers 1.5G high / 3G max, commands 2G / 4G, `OOMScoreAdjust=500`. A command's result goes to
  `~/data/dev/runs/<project>--<command>.json`; output is in the journal.
- `bin/dev`: the command agents use (same library, works without the server).
- `server.py`: stdlib HTTP on `127.0.0.1:8106`, service `dev.service`. `index.html`: the page,
  polling every 4s.
- `bin/preview <port>` publishes a port: `tailscale serve` on Tailscale, or a socat unit
  (`preview-<port>`) from the VM's address to localhost on exe.dev.

## JSON API

- `GET api/projects`: every project with recipe, servers (state, port, preview, memory), commands
  (last run), git.
- `GET api/projects/<name>`: one.
- `POST api/projects/<name>/up` / `down` / `restart` `{servers?: [..]}` (default all).
- `POST api/projects/<name>/run` / `stop` `{command}` (`setup` included).
- `GET api/logs?unit=<unit>&n=300&since=<unix>`: a dev or preview unit's output.
- `GET api/ports`: every open port with kind (dev, app, springroll, preview, stray, other) and owner.
- `GET api/projects/<name>/keys`: the keys its recipe names, `set` or not (names only, never values).
  `POST` `{var, secret, note?}` has the project read Keys' `secret` as `$var` (what Keys' Add a key →
  Used by calls; `dev keys <project> --add VAR=KEY` for agents).
- `POST api/projects/<name>/env/preview` `{text}`: how a pasted .env would be sorted (key values
  masked; nothing saved). `POST api/projects/<name>/env/import` `{text, choices: {NAME: env|key|skip}}`
  applies it.
- `GET api/projects/<name>/database`: its dev database (fresh from Neon); `POST` `{action: create|reset|delete}`.
- `GET api/status`: the sidebar chip (204 when nothing runs).
