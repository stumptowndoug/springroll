---
name: connections
description: How this machine reaches outside services and coding agents - Connections, the catalog (connections/catalog.json), Keys and secret request/get/set, sign-ins (gh, coding agents), MCP servers, and running other agents headless. Use when connecting a new service, when a key or sign-in is missing or has lapsed, or when working with other coding agents.
---

# Connections and keys

Connections (in the sidebar) is what the box can reach: coding agents, and outside services
(GitHub, Gmail, Slack, Notion, Home Assistant, …) from the catalog, `connections/catalog.json`.
**Keys** (its own sidebar page, `#/keys`) holds them: every secret as `NAME=value`, including
service keys and any the owner added, plus the sign-ins Springroll keeps. All keys live in
`~/.config/springroll/secrets.env` and are **environment variables in every new chat and job**
(`$GH_TOKEN`, `$SLACK_BOT_TOKEN`, …). Use them with the service's CLI or API. Never print them,
write them into the repo, or put them in an app's frontend; an app that needs one reads it
server-side from the environment or `secrets.env`. Springroll masks key values in chat timelines,
but don't rely on it.

**Need a key you don't have? Never ask the owner to paste it into chat** (that sends it to the
model provider and keeps it in the chat). Run `secret request NAME "what it's for"`: the owner gets
a card on the Timeline (and in Keys) and pastes it there, and you get a message in this chat when
it's saved. A session that was already running doesn't have new keys in its environment: use
`"$(secret get NAME)"` inline (never echo it). `secret list` shows names;
`printf %s "$v" | secret set NAME "note"` saves a key you generated.

Some services sign in instead (GitHub: `gh auth login` from Springroll's Connections page, a device
code the owner approves). Then use their CLI (`gh`, and `git` over HTTPS via `gh auth setup-git`);
there's no env var. Repos you clone go in `~/projects/<name>`.

To connect something new: add an entry to `catalog.json` (fields, how to get the key, a test
command) so the owner can paste the key in Springroll, or walk them through it in chat. Start new
integrations read-only. A service's MCP server (if it has one) is opt-in per connection
(`connections/<name>/mcp.json`, handed to every new chat).

Keys' values can be shown on the Keys page unless the owner turned that off (Settings → Keys,
`desk.json` `keys.reveal`).

## Coding agents

Several harnesses may be installed (`agents/agents.json`: how each installs, signs in, starts,
resumes, and runs headless). Don't depend on any one: anything you build must work no matter which
agent maintains it, which is why the rules live in `AGENTS.md`.

Sign-ins to coding agents (their plans) live in Connections → Coding agents. When one is missing or
has lapsed (here or on a Sprite), don't tell the owner how to log in:
`signal --needs --key signin:<agent>[@<sprite>] "Sign in to <Agent>…" "why"` puts it on the
Timeline with a **Sign in** button that walks them through it.

To delegate or get a second opinion, run another harness headless (`headlessArgv` in
`agents.json`: `codex exec …`, `claude -p …`, `opencode run …`) and review its result yourself. For
a full plan/delegate/audit run, follow `skills/orchestrate/SKILL.md`. To show the owner a dev
server, run `preview <port>`.
