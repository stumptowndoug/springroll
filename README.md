<p align="center"><img src="seed/home/views/desk/public/icon.svg" width="112" alt="Springroll"></p>

<h1 align="center">Springroll</h1>

<p align="center"><b>Your own computer, run by agents.</b></p>

Ask for what you want: sort my mail, check this site every morning, keep my projects running.
Claude Code or Codex builds it on a Linux server you own, runs it on schedule, and tells you only
what needs you.

On an ordinary computer you install apps someone else wrote and live with them. Here you ask, and
an agent builds them: a small web app, a job on a timer, a script that watches something. When you
want them different, you ask again. Everything that happens lands on one **Timeline** you open
from your phone or laptop.

**Yours.** It runs on your server, with the coding-agent subscription you already pay for.
Everything the agents build, and Springroll's own code, lives in one git repo on that machine,
backed up nightly, so the box can be wiped and rebuilt from a single file. No hosted service and no
account with us; the only thing it fetches from us is the weekly update, from this repo.

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

## What you might ask for

- "Sort my mail every morning and tell me what needs a reply."
- "Watch this product page and tell me when it drops under $300."
- "Every Monday, sum up what changed in my GitHub repos."
- "Run my side project so I can open it from my phone."
- "Build me a page that tracks my reading list."
- "Log in to the utility site each month and save the bill."

Each one becomes an app, a job, or both, built while you watch. It keeps running after the chat
ends, and anything that needs you shows up on the Timeline.

## Yours to change

Springroll is a starting point, not a product you put up with. Its own code sits in the same repo
as everything the agents build, so they can change any of it:

- **The apps.** Make Mail work the way you read mail. Delete To-dos. Ask for an app nobody else
  would want.
- **Springroll itself.** Add a page to the sidebar, change what counts as "needs you", rebuild the
  Timeline around how you work.
- **How it looks.** 18 themes, your own colors and fonts, or "make it look like a newspaper."
- **How the agents behave.** Their rules are plain text (`AGENTS.md`, the skills). Change a rule
  and every agent follows it from the next chat.
- **The machine.** It's a whole Linux box: a database, a Discord bot, a scraper, anything that runs
  on Linux.

Updates don't undo any of it. Your machine is your fork: each week an agent merges what's new here
around your changes, and `LOCAL.md` keeps the list of what you've made your own.

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

Springroll is from the maker of [Shep](https://github.com/stumptowndoug/shep), a Mac workspace for
running coding agents across your projects. It carries over Shep's ideas, chief among them a
chat that runs every agent through the [Agent Client Protocol](https://agentclientprotocol.com),
and puts them on a server that never sleeps.

## License

[MIT](LICENSE).
