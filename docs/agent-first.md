# Agent first

Springroll is a computer run by agents. Its job is not to show you screens; it's to know what's
happening on and around the machine, decide what's worth your attention, and act for you. Apps and
screens still exist, but they're the back room, the way files are hidden behind apps on a phone:
the inverse of ordinary software.

> **The machine watches. You decide.**

## Principles

1. **Silence is the default.** Springroll works while you're not looking. Your attention is the scarce
   resource; spend as little of it as possible.
2. **Agents before screens.** Every capability exists first as something an agent can read, do and
   watch, through one way of finding it. A screen is optional, and comes last.
3. **Everything that happens is an event; nothing that happens is a screen.** Runs, mail, service
   activity, the box's health: all of it lands in one log. None of it gets a widget.
4. **An agent decides what earns attention.** It turns events into a few cards: a decision only you
   can make, a fact you'd want today, a receipt for what it handled. The rest stays in the log.
5. **A card is a finished thought.** What happened, why it matters to you, what it suggests, and the
   buttons to do it, talk about it, or let it go.
6. **You teach it by reacting.** Reactions become rules in plain English, in files you can read.
7. **Screens are generated, not built.** Ask to see something and the answer is a view. Ask for it
   often and it becomes an app.
8. **Trust through receipts.** What an agent did on its own is visible, explained and, where possible,
   undoable. Nothing leaves the machine (mail, money, posts) without your yes, unless you've said so
   for that kind of thing.

## The layers

```
  sources          capabilities           events             attention            presentation
  ─────────        ────────────           ──────             ─────────            ────────────
  apps, services,  what agents can READ,  one log of what    an agent turns       feed of cards +
  jobs, the box    DO, see the STATUS of, happened, from     events into cards,   one composer;
                   and WATCH, found in    hooks and polls    learns from your     apps behind it
                   one place                                 reactions
```

The priority is left to right. A beautiful feed over thin capabilities is worthless; good capabilities
with a plain feed are already most of the value.

### 1. Capabilities: everything an agent can read, do, see and watch

Today each app documents its API in prose in its README, and each service has its own command.
An agent can do a lot, but only after reading the right READMEs. Instead, each app and connection
declares its capabilities in one file, and Springroll gathers them into one catalog.

`views/<app>/capabilities.json` (and `connections/<name>/capabilities.json`):

```json
{
  "name": "mail",
  "about": "The owner's Gmail, every account, synced every 3 minutes.",
  "status": { "get": "api/status" },
  "read": [
    { "name": "search", "get": "api/list?q={query}&before={ts}", "about": "Messages matching a query, newest first" },
    { "name": "message", "get": "api/msg/{id}", "about": "One message: headers, text, triage" }
  ],
  "do": [
    { "name": "archive", "run": "gmail archive {id}", "effect": "reversible" },
    { "name": "reply", "run": "gmail reply {id}", "stdin": "text", "effect": "outward" },
    { "name": "pause-triage", "post": "/api/agent/jobs/mail-triage", "body": { "enabled": false }, "effect": "reversible" }
  ],
  "events": ["mail.received", "mail.triaged", "mail.sync_failed"]
}
```

- **status**: is it healthy, connected, behind? One call per app, one shape:
  `{ok, text, level: ok|warn|danger, since}`. The sidebar `STATUS` chip becomes a special case of this.
- **read**: the data, as JSON.
- **do**: toggles, switches, actions. Each has an **effect**, which sets how much an agent may do
  alone:
  - `read`: always.
  - `reversible`: may do on its own, with a receipt (pause a job, archive, restart a service).
  - `outward` (leaves the machine: mail, posts, payments) and `destructive`: ask first, unless
    the owner has said otherwise for that action.
- **events**: what it reports into the log.

One way in for every agent, whichever harness it is:

- **`sr` command:** `sr` lists everything (`sr mail`, `sr jobs`, `sr github`). `sr mail search
  "invoice"`, `sr mail archive 812`, `sr status` (the whole machine in one screen of text), `sr events
  --since 1h`. It reads the catalog, so a new app's capabilities appear without new code.
- **A Springroll MCP server:** the same catalog as tools, handed to every chat and job session (agentd
  already passes MCP servers from Connections), so agents see `mail.search` and `jobs.pause` as tools
  without reading anything.

Springroll's own parts declare capabilities the same way: jobs (list, run, pause, history), signals
and cards, connections, the box (memory, disk, services, restart), backups, updates, agents and their
sign-ins.

### 2. Events: one log of what happened

An `events` table in agentd: `{id, at, source, kind, subject, summary, data, link}`.

- **Pushed** by whatever notices it: a job run ends (with its report), mail sync sees new mail, the
  triage job sorts it, a connection sync finds a new PR, the System watchdog sees memory climb, an
  agent takes an action on its own (that's the receipt).
- **Polled** for services without hooks: the existing sync jobs (`signal sync`) also write events.
- **Hooks** where a service offers webhooks, through a small receiver (later: a front door on the
  internet for webhooks).
- `event "<summary>" --source github --kind pr.opened --link …` from anything; `sr events` and the
  MCP tools to query it. Kept 90 days; summarized after that.

The log is the memory the attention agent reads. It's also how you debug the attention agent: every
card cites the events behind it.

### 3. Attention: what earns your attention, and when

An **attention agent** runs every 15 minutes (and right away for events from sources marked urgent). It
reads new events, the current cards, and `ATTENTION.md`, and decides for each event:

- **Needs you:** a card that stays until handled (a decision, an approval, a failure only you can fix).
- **Worth knowing:** a card for today, then it expires.
- **Done for you:** goes in the day's receipt ("Sorted 23 emails, renewed the TLS cert, Carrot
  refreshed TX: 4 new institutions").
- **Nothing:** stays in the log.

Cheap first, smart second: plain rules in `ATTENTION.md` (and per-domain files like Mail's
`RULES.md`) settle most events without a model ("Stripe receipts: done", "DMARC reports: nothing").
Only what's left goes to a small, fast model, in batches. A budget keeps it calm (aim: no more than a
handful of cards a day; group related ones).

Cards are what Springroll calls signals today (`needs`, `notable`, `brief`), with three additions: the
events they're about, a suggestion ("Reply that you'll call Thursday"), and actions taken from the
capability catalog ("Archive", "Pause the job"), so the button does the real thing.

**Learning.** Every card has quiet feedback: *Not interested*, *More like this*, *Handle these
yourself*. Each becomes a line in `ATTENTION.md` ("GitHub review requests from dependabot: handle
yourself: approve if CI passes"). Once a day the agent merges and tidies the file. The owner can read
and edit it; "why did you show me this?" quotes the rule or the reasoning.

### 4. Presentation: the feed first, the apps behind it

- **Home is the feed:** Needs you, Worth knowing, today's receipt, and one composer:
  *Ask or tell Springroll…* That's the product.
- **Conversations** hang off cards ("chat about this run") and stand alone.
- **"Show me…"** answers with a generated view (a report, a table, a chart) inline. "Keep this" saves it
  as a pinned view; one you keep coming back to can become an app.
- **Apps** (Mail, Carrot, To-dos) are a drawer: reachable from a card's View, from Ctrl+K, or "open
  mail", not a row of sidebar items.
- **Machine** holds the rest: routines (jobs), accounts (agents, services, keys), files, terminal,
  health, backups, updates, appearance, and the raw event log.

The sidebar shrinks to:

```
Springroll
  Home       ● 2
  Chats
  Apps       (the drawer)
  ─
  Machine
```

Gauges, upcoming-job lists and service tiles leave the main surfaces. The box's health shows only as
a card when something's wrong, or as one line in the day's receipt.

## How it maps onto what exists

| Today | Becomes |
|---|---|
| App READMEs describing APIs in prose | `capabilities.json`, gathered into one catalog |
| `signal`, `gmail`, `secret`, app APIs | `sr` and the Springroll MCP server (old commands keep working) |
| `STATUS` sidebar chips | `status` in each app's capabilities |
| Signals (`needs`, `notable`, `brief`) | Cards, with events, a suggestion and real actions |
| Mail triage's `RULES.md`, job `NOTES.md` | The same idea, generalized: `ATTENTION.md` |
| Job reports, "36 routine runs, all fine" | Events; the good ones become the day's receipt |
| Home, Jobs, Connections, Settings, System pages | Home (feed); the rest under Machine |
| Sidebar app list | The Apps drawer |

## Order of work

1. **Capabilities.** The catalog format; `capabilities.json` for Mail, jobs, the box, signals and
   connections; `sr` (list, status, read, do); the Springroll MCP server in every session. *This is the
   priority: agents that can easily see and change everything.*
2. **Events.** The `events` table and `event` command; job runs, mail sync, triage, connection syncs, the
   watchdog and agents' own actions write to it; `sr events`.
3. **Attention.** `ATTENTION.md`; the attention job (rules first, then a small model, in batches); cards
   with events, suggestion and actions; the daily receipt; feedback buttons that write rules.
4. **Presentation.** Home as the feed plus composer; the four-place sidebar; Machine; "show me" and
   "keep this".

Each step is useful by itself. Step 1 makes every chat and job better immediately, before any of the
UI changes.

## Open questions

- **Urgency:** which sources warrant waking the attention agent right away (a needs-you email from a
  person, a failing backup) instead of the next 15-minute pass?
- **Budget:** how many cards a day before it feels noisy? Start at five and tune.
- **Push:** which cards ping the phone? Today it's anything "needs you". Probably still right.
- **Model:** which agent and model runs the attention pass, and the cost ceiling per day.
- **Outward actions:** which kinds of action may run without asking once trusted (email replies already
  can, by the owner's choice)?
