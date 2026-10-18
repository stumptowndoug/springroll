# FAQ

**What is it, in one line?**
Your own computer, run by agents: a Linux server where Claude Code or Codex builds the tools you
ask for, runs them on schedule, and tells you only what needs you.

**Is this like OpenClaw?**
They're neighbors. [OpenClaw](https://github.com/openclaw/openclaw) is an assistant that meets you
in the chat apps you already use. Springroll is a machine where coding agents build and run
software for you: apps with their own pages, jobs on a schedule, one Timeline. One is a voice, the
other is a workshop. Springroll doesn't bring its own agent; it runs the ones you already use.

**What does it cost?**
The server, plus the coding-agent plan you already have. exe.dev is $15/month for 2 vCPU and 4 GB
(the easiest start); a 4 GB VPS is about the same. Agents run on your Claude or ChatGPT
subscription. Springroll is free and MIT-licensed, and there's no hosted tier.

**Which agents?**
Claude Code, Codex, OpenCode, Pi, Cursor and Antigravity, in chats and jobs. Claude Code or Codex
on a subscription is the tested path. Adding one is an entry in `seed/home/agents/agents.json`.

**Do I need to be a developer?**
Not to install it: your coding agent does that, and you click links and sign in. Day to day you
talk to it. Today it helps to know what a server and a git repo are, because sometimes you'll ask
an agent to fix something and want to follow what it did.

**Can I run it on my laptop?**
In a Linux VM (OrbStack, Lima, UTM, WSL2 with systemd), yes, but jobs only run while the laptop is
awake. A small server that stays on is the point.

**Why not Docker?**
Springroll runs systemd services: one per app, one per agent session with its own memory limit.
A plain container doesn't have systemd. Any Linux box or VM that does works:
[Packaging](packaging.md).

**What if the box dies?**
Every night `backup` writes one file: the home repo with its full history, every app's data, and
your keys encrypted with your passphrase. Restore it onto a new machine with
`install.sh --restore <file>` and you're back: chats, jobs, apps, data. Off-machine copies to your
own bucket are one setting away.

**I changed Springroll. Do updates wipe that?**
No. Your `~/home` is your fork. The weekly update is an agent merging what's new here around your
changes, and it reports what it took, what it adapted and what it skipped.

**Is my data private?**
It lives on your machine. What an agent reads to do its work (your prompts, files, mail it's
sorting) goes to that agent's model provider, as with any coding agent. Springroll itself sends us
nothing. See [Security](security.md).

**Can more than one person use it?**
One owner per machine, today. Anyone who can reach Springroll can run commands on the box, so keep
it to your own devices.
