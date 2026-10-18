<p align="center"><img src="seed/home/views/desk/public/icon.svg" width="112" alt="Springroll"></p>

<h1 align="center">Springroll</h1>

<p align="center"><b>Your own computer, run by agents.</b></p>

Springroll turns a small Linux server into a computer you run by talking to it. Ask for what you
want (sort my mail, check this site every morning, track my projects) and a coding agent builds the
tool, schedules the job and keeps it working. Everything that happens shows up on one Timeline you
open from your phone or laptop. Everything it builds lives in one git repo, so the machine can be
wiped and rebuilt.

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

## What's on it

- **Timeline**: what needs you, what's running, and every job's report, in one feed.
- **Chat** with Claude, Codex, Cursor and others; they build and fix things on the box.
- **Apps** your agents build (Mail, To-dos, a browser you can watch, Dev for your projects' servers and previews), and **Jobs** on a schedule.
- **Keys and Connections** kept on the machine, nightly backups, and weekly updates the agent merges
  around your own changes.

## More

[The idea](docs/idea.md) · [Installing](docs/install.md) · [The app](docs/desk.md) ·
[Packaging](docs/packaging.md) · [The server](docs/server.md) · `seed/` is what gets installed.

The original Springroll, a Mac app for scheduled AI tasks, is archived at
[springroll-classic](https://github.com/stumptowndoug/springroll-classic).
