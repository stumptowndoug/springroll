<p align="center"><img src="seed/home/views/desk/public/icon.svg" width="112" alt="Springroll"></p>

<h1 align="center">Springroll</h1>

<p align="center"><b>Your own computer, run by agents.</b></p>

Ask for what you want: sort my mail, check this site every morning, keep my projects running.
Claude Code or Codex builds it on a Linux server you own, runs it on schedule, and tells you only
what needs you.

On an ordinary computer you install the apps. Here you ask, and an agent builds them: a small web
app, a job on a timer, a script that watches something. Everything that happens lands on one
**Timeline** you open from your phone or laptop.

**Yours.** It runs on your server, with the coding-agent subscription you already pay for.
Everything the agents build lives in one git repo on that machine, backed up nightly, so the box
can be wiped and rebuilt from a single file. No hosted service and no account with us; the only
thing it fetches from us is the weekly update, from this repo.

[How it works](docs/how-it-works.md) · [Install](docs/install.md) · [Security](docs/security.md) ·
[FAQ](docs/faq.md) · [Why Springroll](docs/design/idea.md)

## Get started

Paste this into Claude Code, Codex or any coding agent on your laptop:

```
Set me up with Springroll: follow https://raw.githubusercontent.com/stumptowndoug/springroll/main/docs/install.md
```

It picks a server with you (exe.dev at $15/month is the easiest; any Linux box works), installs
Springroll, and hands you the address. You click a few links and sign in Claude or Codex.

Already have a Linux server with systemd?

```sh
sudo git clone https://github.com/stumptowndoug/springroll /opt/springroll && sudo /opt/springroll/seed/install.sh
```

Then open Springroll and start a chat. Everything else you ask for.

## What it does in a week

- **Every 15 minutes** a job sorts your new mail, files the noise and puts the two emails that need
  an answer on the Timeline, each with a draft reply waiting for your yes.
- **Every morning** a job pulls yesterday's numbers for your site (search, traffic, sign-ups) and
  writes a one-page report with charts. You read it on your phone with coffee.
- **On Sunday** a long data refresh runs for hours, checks its own work every ten minutes, and
  posts one line when it's done.
- **When you open a project** the Dev app starts its servers with the keys it needs, gives it its
  own branch of the database, and hands you a preview link.
- **When a site has no API** an agent drives a real browser while you watch, and hands you the
  mouse for the sign-in.

None of that ships in the box. Each one is a sentence you say once.

## How it fits together

- **[Timeline](docs/how-it-works.md#timeline)**: what needs you first, then what's running, then
  every job's report. It's the front page.
- **[Chats](docs/how-it-works.md#chats)** with Claude Code, Codex, OpenCode, Pi, Cursor or
  Antigravity. They have a shell and `sudo` on the box and build whatever you ask for.
- **[Apps](docs/how-it-works.md#apps)** the agents build, each a folder with its own small server:
  Files, Browser, Dev, To-dos, Mail and whatever comes next.
- **[Jobs](docs/how-it-works.md#jobs)**: agents or plain commands on a schedule, each with a report
  on the Timeline and notes it keeps between runs.
- **[Keys and Connections](docs/how-it-works.md#keys-and-connections)**: secrets stay on the
  machine and reach agents as environment variables. Gmail, GitHub, Slack, Notion, Linear and more.
- **[The home repo](docs/how-it-works.md#the-home-repo)**: `~/home`, where all of the above lives,
  in git. Backups and weekly updates work on it.

## Security

The agents have full control of the box: a shell, `sudo`, the network. That's the point, and it's
why the box should be one you can afford to lose. Springroll listens only on `127.0.0.1`; you reach
it over Tailscale or exe.dev's private login, and nothing is public. Email waits for your yes
before it's sent. Read [Security](docs/security.md) before you connect your accounts.

## Docs

| You want to | Read |
|---|---|
| Understand the pieces | [How it works](docs/how-it-works.md) |
| Install it, or have an agent install it | [Install](docs/install.md) |
| Know what the agents can touch | [Security](docs/security.md) |
| Run it on another distro, size a box, move machines | [Packaging](docs/packaging.md) |
| Get a quick answer | [FAQ](docs/faq.md) |
| Know why it's built this way | [The idea](docs/design/idea.md) · [Agent first](docs/design/agent-first.md) |
| Change Springroll itself | [Build notes](docs/design/build-notes.md) · the skills in [`seed/home/skills/`](seed/home/skills) |

`seed/` is what gets installed; `seed/home/AGENTS.md` is what every agent on the machine reads first.

## Where it came from

The first Springroll was a Mac app for scheduled AI tasks: recipes, integrations, an engine per
model. It drowned in edge cases, and the lesson was that the agent is the framework. That version
is archived at [springroll-classic](https://github.com/stumptowndoug/springroll-classic). This one
gives the agent a machine and gets out of the way. The chat borrows from bb, the agent harness
lessons from Shep, and the chats run through the
[Agent Client Protocol](https://agentclientprotocol.com).
