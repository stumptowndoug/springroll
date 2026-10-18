# How it works

Springroll is a thin layer on an ordinary Linux server: a web page you open, a daemon that runs
coding agents, and one git repo where everything they build lives. The agents do the rest.

```
Your phone or laptop                Springroll in the browser (installable as an app)
        │ HTTPS over Tailscale or exe.dev's private login
        ▼
Springroll  :8000      the page, settings, keys, backups, a proxy to every app
  ├── agentd :8090     chats and jobs: one coding agent per chat, through the Agent Client Protocol
  │                      Claude Code · Codex · OpenCode · Pi · Cursor · Antigravity
  ├── /v/<app>/        each app's own small server, or static files
  └── /term/           a terminal in the browser (tmux), for anything else
```

All of it binds to `127.0.0.1`. All of it lives in `~/home`, so an agent can change any of it,
Springroll included.

## Timeline

The front page. Everything that happens on the machine, in one feed, newest first:

- **Needs you** comes first: a decision, an email waiting for a reply, a key an agent asked for, a
  failed run. A model reads the last day and a half, merges what belongs together, ranks it, and
  writes one line on why each matters. Click a row and an agent already has the context.
- **Running**: what's working right now, with how long it's been at it.
- **Reports and Worth knowing**: every job run's report, and anything you'd want to know today but
  needn't act on, by day.

Anything can put a row there: a job, an agent, an app, or a connector to GitHub, Linear or a bank
(`signal --needs "Approve the vendor quote?"`). Phone notifications go through
[ntfy](https://ntfy.sh). Agents' guide: `seed/home/skills/timeline/SKILL.md`.

## Chats

Each chat is one coding agent with a shell on the machine, started in `~/home`, reading
`AGENTS.md` first. Ask for something and it does it: builds an app, writes a job, installs a
package, fixes what broke. You see its messages, one line per step, and its answer at the end.

Springroll draws its own chat instead of wrapping a terminal: approvals, diffs and history work on
a phone. Under it, agentd talks to each harness through the
[Agent Client Protocol](https://agentclientprotocol.com), so nothing is specific to one agent. Add
one by adding an entry to `seed/home/agents/agents.json`.

Two access modes: **Full access** (the default; the box is the sandbox) and **Ask first** (you
approve each action). Personas change how an agent talks in a chat (`/persona <id>`), never what it
does.

## Apps

An app is a folder, `~/home/views/<name>/`: a README, an icon, and either a static page or a small
server on its own port, run as a systemd service. Springroll shows it at `/v/<name>/` and in the
sidebar. Every app exposes its data as a JSON API, so agents can use it as well as you.

Every machine gets **Files** (read anything on the box), **Browser** (a real browser agents drive
and you can take over), **Dev** (run your projects with previews), **To-dos**, **Settings** and
**Gallery** (the design kit). **System** (memory, CPU, disk, a watchdog) is on by default; **Mail**
(Gmail, read-only) is a template you add. Everything else is whatever you ask for. Agents' guide:
`seed/home/skills/apps/SKILL.md`.

## Jobs

A job is a folder, `~/home/jobs/<name>/`, with `job.json` (a schedule in cron, the prompt or
command) and `NOTES.md`, the agent's memory between runs. Each run is a chat you can open; its
report goes on the Timeline and, if you like, your phone. Missed runs are skipped, runs never
overlap, and a quick `onlyIf` check keeps a frequent job from starting an agent when there's
nothing to do.

Every machine starts with a nightly backup, a weekly backup test, nightly housekeeping, a weekly
Springroll update, and a sync that puts pull requests waiting on your review under Needs you (once
GitHub is signed in). Mail triage comes switched off. Agents' guide:
`seed/home/skills/jobs/SKILL.md`.

## Keys and Connections

**Keys** holds every secret as `NAME=value` in `~/.config/springroll/secrets.env`, readable only by
the agent's user and never in git. Each one is an environment variable in every chat and job. An
agent that needs a key you haven't given it puts a card on the Timeline for you to paste into
(`secret request`), so keys never pass through a chat.

**Connections** is what the machine can reach: the coding agents you sign in (your Claude or
ChatGPT subscription), and services from a catalog (GitHub, Gmail, Google Calendar, Slack,
Telegram, Notion, Linear, Todoist, Home Assistant, Cloudflare, Firecrawl, browser providers and
more). There's no integration framework: each entry says which key to ask for and how to test it,
and the agent uses the service's own CLI or API. Anything not in the catalog, ask for.

## The home repo

`~/home` is a git repo the agents commit to after each change: Springroll itself, every app, every
job, the skills that teach agents how this machine works, and `notes/`, the agents' memory of you.
Data lives next to it in `~/data/<name>/`.

- **Backups**: `backup` writes one file each night: the repo with its full history, every app's
  data, and your keys and sign-ins encrypted with your passphrase. `install.sh --restore <file>`
  rebuilds a new machine from it. Off-machine copies go to your own bucket (GCS, S3, R2, B2, Azure)
  through restic, and a weekly job test-restores them.
- **Updates**: your `~/home` is your fork. Each week an agent merges what's new in this repo the
  way a maintainer would: it takes what fits, keeps your changes, skips what you've replaced, and
  reports what it did. `seed/home/CHANGELOG.md` is written for that agent.

## The machine

Springroll needs a Linux box with systemd, 4 GB of RAM and 30 GB of disk. It keeps itself healthy: a
watchdog calls an agent when memory or disk runs short, and long or heavy work can move to a [Fly
Sprite](https://docs.fly.io/sprites/) (a cloud machine that sleeps when idle). Sizes, tested distros
and moving machines: [Packaging](packaging.md).