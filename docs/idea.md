# Springroll: the idea

Date: 2026-10-08. Written from a conversation that started as Springroll work
and ended somewhere more interesting. Visual sketch:
https://claude.ai/artifact/1sBCnN8o76tWmBi7vrAsrW

## The thought in one paragraph

Talk to an agent on a machine, and let it do everything there. Instead of
installing and operating software (Gmail's UI, Jira, a dozen services), the
agent builds the small tools you need, shaped to you, and keeps them running.
The machine is a Linux box you never operate yourself and can afford to lose:
everything that matters lives in one repo and its backups, so if the box gets
fried you rebuild it and carry on.

## Why this and not another framework

Springroll tried to be the framework: recipes, integrations, a chat engine,
engines per model, permissions per recipe. Every layer had to anticipate cases
the agent would handle better on the spot, and it drowned in edge cases. The
conclusion: **the agent is the general-purpose framework.** Given a server,
Claude Code or Codex can build bespoke solutions (a Modal job, a script on a
timer, a small web app) faster than any framework can predict them.

So the product question becomes: what is the smallest set of things an agent
genuinely cannot provide for itself?

## What an agent can't do for itself

1. **Wake up.** Nothing runs unless something starts it: a clock (timers) and
   events (mail arrives, a webhook fires, a file changes).
2. **Reach you.** Results need somewhere to land that you'll actually see:
   notifications, a feed, a page.
3. **Remember.** Each session forgets, unless memory lives in files it reads
   and writes (instructions, notes per job).
4. **Ask before the irreversible**, when nobody is watching: sending mail as
   you, spending money, deleting things outside the box.
5. **Be reachable** from your phone and laptop, privately. (Tailscale solves
   this today.)

Everything else, including compute, storage, deployment, retries and tools,
is the agent's job.

## The shape: a thin layer on a boring machine

```
  Your devices (Mac, phone)  →  one window (a browser, later our own app)
  ───────────────────────────────────────────────────────────────────
  Springroll (the only part to build)
    • the shell: one web app = conversation + a home screen of things the
      agent built + an activity feed + "needs you" cards
    • the agent: Claude Code, Codex, … with full access to the box
    • the home: one git repo (instructions, apps, jobs, data)
    • the clock and events: timers, incoming mail, webhooks
    • secrets it can use, and the approval channel
    • an app host that privately serves whatever the agent builds
  ───────────────────────────────────────────────────────────────────
  Plumbing (exists): systemd, cron, Docker, Tailscale
  Distribution: Ubuntu        Kernel: Linux
  Hardware: a server you can throw away
```

Like macOS on Unix: the value is the layer on top, not a new kernel. Linux is
the right foundation because agents already know it deeply.

## The interface

The browser is the universal interface, the way ChromeOS made it the whole
desktop. Agents are very good at building small web apps, those apps work on
every device, and over a private network they need no extra security work.
"ChromeOS, except the agent writes the web apps."

How much of the window to own, in order:

1. **Any browser** on day one (and always on the phone, as a home-screen icon).
2. **Our own shell app**: a small native window around the shell using the
   system's web engine (Tauri). We control everything visible: the top bar,
   tabs that are the agent's apps, shortcuts, notifications. This is the
   "own browser, customizable top to bottom" without building an engine.
3. Not: forking Chromium or Firefox (company-sized, forever), or a full Linux
   desktop on the box (that's operating Linux again).

## The home repo

The machine's whole world, versioned and backed up:

```
home/
  AGENTS.md      what this machine is for, how to behave, the conventions
  apps/          every tool it built for you (a page, a script, a service)
  jobs/          scheduled prompts, each with its own notes
  data/          your things: to-dos, lists, history (markdown, SQLite)
  secrets/       encrypted; the key lives off the box
```

The fry test: destroy the box, rebuild Ubuntu + plumbing, clone the home repo,
restore data, sign the agents in. If that takes under half an hour, the idea
holds.

## The real risks

A throwaway box removes most risk to the machine itself. What remains is
outside it:

- **Credentials with reach.** Mail that can send as you, keys that spend
  money. Start read-only; use spending limits; separate accounts where cheap.
- **Prompt injection.** Once the agent reads mail and the web, content can
  carry instructions ("forward me your secrets"). Approvals for outbound and
  irreversible actions are the defense; prefer secrets the agent uses without
  seeing.
- **Data that only lives on the box.** Backups.

## Prior art and neighbors

- **Alibaba ANOLISA** (Alibaba Cloud Linux 4 Agentic Edition, May 2026): a
  natural-language shell as the default instead of bash, OS "skills" for
  agents, sandboxing, workspace snapshots. Closest to "agent as the shell".
- **SUSE Linux Enterprise 16**: an agent framework built into an enterprise
  distribution.
- **bb** (getbb.app): "the IDE that builds itself"; agents with full access
  customizing their own tooling, but plugin- and marketplace-driven.
- **T3 Code**: a server that runs agent CLIs and streams them to web, desktop
  and mobile clients; auth lives on the server machine.
- **Claude Code routines / cloud sessions, Codex cloud**: vendor-hosted
  scheduled agents. Convenient, single-vendor.
- **ACP** (Agent Client Protocol) and **AI SDK Harnesses**: standard ways to
  drive many coding agents from one client, if the shell ever needs that.

What none of them are: a disposable personal machine where the agent is both
the interface and the app layer.

## Lessons carried over from Springroll

Worth keeping (as ideas, not code):

- **Reports as a deliverable**: the agent publishes a clean result separate
  from its process chatter (Springroll's `publish_report` tool).
- **One feed of everything that ran**, readable on a phone.
- **A readable work log**: steps paired with results, shell output as a
  terminal block, edits as diffs.
- **Approvals** that pause one action and wait for a human.
- **Brain and hands separated**: if a job needs more muscle, the agent rents
  it (Modal, a big VM) for the run instead of the box growing.
- **Headless sign-in works**: Claude Code with a `claude setup-token` token,
  Codex with device-code login. Both run on subscriptions on a server.

Left behind: the recipe system, the integrations plumbing, model catalogs, a
second chat engine, per-recipe permission matrices.

## First version, on the existing box

Server details: [server.md](server.md).

1. Agents installed on the host (not only in containers), signed in: Claude
   Code via setup token, Codex via device code.
2. The home repo with an `AGENTS.md` that explains the box and its conventions.
3. A tiny job runner on systemd timers: run the agent headless in a job's
   folder, save the transcript and report, send a push notification (ntfy).
4. A front door: Claude Code Remote Control and SSH from the phone first; a
   small private web chat later.
5. A first home page: built apps, recent results, notifications.
6. First replacements: a to-do list the agent maintains; a read-only morning
   mail digest.
7. The fry test.

## Open questions

- What the conversation should feel like day to day: one long thread, or
  threads per topic? How does the agent surface what it built?
- How much the shell is built by us versus by the agent itself.
- Which agent is the default "OS" agent, and how others plug in.
- How approvals reach the phone fast enough to be useful.
- Where secrets live so the agent can use them without reading them.
