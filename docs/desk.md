# The Desk (v2)

Built 2026-10-08/09. What the owner sees and uses: a sidebar shell in the
browser (installable as an app), where they chat with coding agents, open
Views the agents built, schedule jobs, connect services, and watch the
machine. Design language from Springroll; thread UX from bb; agent harness
lessons from Shep.

## Pieces

```
Browser (Mac, phone)                       one page: views/desk/public/
  sidebar · Today · chats · Views · Jobs · Connections · Terminal · Settings
        │ HTTPS via Tailscale (or ssh -L)
        ▼
Desk server  :8000  views/desk/server.mjs      Views proxy, settings, templates,
  │                                             connections, backups, sessions
  ├── /api/agent/* ──► agentd  :8090  agentd/   threads + jobs (SQLite)
  │                       │  Agent Client Protocol over stdio, one process per
  │                       │  active thread, each in its own systemd scope
  │                       ▼
  │                    claude-code-acp · codex-acp · opencode acp · pi-acp
  ├── /v/<name>/ ────► each View's own server (PORT) or static files
  └── /term/ ────────► ttyd → tmux sessions (shells, sign-ins, any agent's TUI)
```

All of it lives in `~/home` (git), so agents can change any of it.

## Chat: why structured, not terminals

Terminals give every harness for free but the Desk can't understand them:
status is screen-scraping, approvals live inside the TUI, phones are rough,
there's no rich rendering or history. bb and T3 Code both drive harnesses
through their structured modes and draw their own UI. We use the **Agent
Client Protocol (ACP)**: one client covers Claude Code and Codex (Zed's
adapters), OpenCode (built in) and Pi (`pi-acp`). Probed on the box: streaming
text, tool calls with input/output/diffs, plans, permission requests, usage,
model lists, modes, and `session/load` to resume after restarts.

agentd normalizes ACP updates into timeline items: `user`, `text`,
`thought`, `tool` (toolKind, status, rawInput, content incl. diffs), `plan`,
`permission`, `media`, `notice`, `turn` (stopReason, duration). The Desk
renders them bb-style:

- A completed turn folds into **"Worked for 41s · 6 steps · 2 edits"**; the
  final answer stays visible below it (the agent's last message is the
  answer; AGENTS.md asks agents to end with it).
- While live: each tool call is one line with a present-tense shimmering
  label ("Running npm test"); finished steps fade; a "Working 12s" line.
- Tool rows open to a terminal block (`$ cmd` + tail of output) or a real
  line diff.
- Approvals appear as a card above the composer with the agent's own options
  (deny left, allow always, allow once); the timeline keeps a one-line record.
- Composer: agent, model, folder and access pickers (combobox), slash commands
  from the agent, Enter to send, queueing while the agent works, drafts saved.

**Access**: "Full access" (default; the box is the sandbox) switches the
harness to its full mode and answers any permission request with allow;
"Ask first" shows every request to the owner.

Agents start on demand, stop after 15 idle minutes, and resume their session
on the next message. Each runs in `agentd-<thread>-*.scope` with
`MemoryHigh` and a raised OOM score, so the System View can show which chat
uses what and the kernel kills a runaway agent before the Desk.

## Jobs

`~/home/jobs/<name>/job.json` + `NOTES.md` (the agent's memory between runs).
Five-field cron in local time, plain-English descriptions ("Weekdays at 7:00
AM"), Springroll's missed-run policy (skip; or `catchUp: "once"` for the most
recent missed slot, never the backlog; never overlap). Agent jobs run as
threads (origin `job:<name>`), their final message is the report and goes to
the phone; command jobs run bash and notify on failure. A nightly backup job
ships by default.

UI: Springroll's recipe cards (title, outcome trail, prompt preview, schedule
strip with the next run in mono, quiet Run now / Pause), a detail page
(prompt, fact grid, run feed, the agent's notes), and an editor sheet with
schedule presets and a live "next run" preview.

## Connections

No integration framework (Springroll's lesson). A catalog
(`connections/catalog.json`) of services with the fields to ask for, how to
get them, and a test command. Values go to `~/.config/agentos/secrets.env`
(600, never in git) and are environment variables in every chat and job;
agents use the service's CLI or API. Test before save. An MCP server per
service is opt-in. "Something else?" hands it to an agent. Deliberately not
offered: an Anthropic API key (Claude Code would switch from the subscription
to API billing).

## State and portability

`backup` makes one file: `~/home` as a git bundle (full history), `~/data`
(SQLite via `.backup`, consistent while running), and secrets + agent sign-ins
encrypted with the owner's passphrase. Settings → Backups downloads it;
`install.sh --restore <file>` rebuilds a new machine from it. Tested: a backup
of the live box restored onto a fresh Ubuntu 24.04 brought back chats, jobs,
the Mail View with its data, and secrets (21/21 checks).

## Design system

Kit v2 (`views/desk/public/ui/`): Springroll's quiet language. Seven-color
themes (20 incl. AgentOS light/dark, every one contrast-checked), derived
surfaces, no resting borders, pill controls, one popover shell + searchable
combobox, chips, feed rows, fact grids, shimmer, markdown renderer, terminal
and diff blocks. Rules in `~/home/DESIGN.md`; everything live in the Gallery
View. Appearance (theme, accent, fonts, density, corners, text size) is in
Settings; `custom.css` for anything else.

## Not yet

- In-browser notifications (phone notifications via ntfy work).
- Usage limits per harness (Shep's 5h/weekly).
- Attachments (images, files) in the composer.
- A native wrapper; the installable web app covers most of it.
- ARM hardware testing.
