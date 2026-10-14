# Springroll (v2)

Built 2026-10-08/09. What the owner sees and uses: a sidebar shell in the
browser (installable as an app), where they chat with coding agents, open
Views the agents built, schedule jobs, connect services, and watch the
machine. Design language from Springroll; thread UX from bb; agent harness
lessons from Shep.

## Pieces

```
Browser (Mac, phone)                       one page: views/desk/public/
  sidebar · Today · Files · chats · Views · Jobs · Connections · Terminal · Settings
        │ HTTPS via Tailscale (or ssh -L)
        ▼
Springroll server  :8000  views/desk/server.mjs      Views proxy, settings, templates,
  │                                             connections, backups, sessions
  ├── /api/agent/* ──► agentd  :8090  agentd/   threads + jobs (SQLite)
  │                       │  Agent Client Protocol over stdio, one process per
  │                       │  active thread, each in its own systemd scope
  │                       ▼
  │                    claude-agent-acp · codex-acp · opencode acp · pi-acp
  ├── /v/<name>/ ────► each View's own server (PORT) or static files
  └── /term/ ────────► ttyd → tmux sessions (shells, sign-ins, any agent's TUI)
```

All of it lives in `~/home` (git), so agents can change any of it.

## Chat: why structured, not terminals

Terminals give every harness for free but Springroll can't understand them:
status is screen-scraping, approvals live inside the TUI, phones are rough,
there's no rich rendering or history. bb and T3 Code both drive harnesses
through their structured modes and draw their own UI. We use the **Agent
Client Protocol (ACP)**: one client covers Claude Code and Codex (Zed's
adapters), OpenCode (built in) and Pi (`pi-acp`). Probed on the box: streaming
text, tool calls with input/output/diffs, plans, permission requests, usage,
model lists, modes, and `session/load` to resume after restarts.

agentd normalizes ACP updates into timeline items: `user`, `text`,
`thought`, `tool` (toolKind, status, rawInput, content incl. diffs), `plan`,
`permission`, `media`, `notice`, `turn` (stopReason, duration). Springroll
renders them bb-style:

- The agent's messages stay in the conversation; each run of thoughts and
  tools between them folds into a row ("Worked · 4 steps · 1 edit"). The last
  row of a finished turn reads **"Worked for 41s · 6 steps · 2 edits"**, and
  the final answer stays visible below it (the agent's last message is the
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
uses what and the kernel kills a runaway agent before Springroll.

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
get them, and a test command. Values go to `~/.config/springroll/secrets.env`
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

## Files

A system View (sidebar → Files, `Ctrl P` to find a file, also in the
launcher) for seeing what's on the machine without a terminal or an editor:
a folder on the left (git status dots, hidden files and sort behind the
filter icon, places: Home, Projects, Data, Agent home, Whole disk), the file
on the right:

- Code highlighted in the theme's own colors, line numbers; click a number
  (shift-click for a range) to select lines, then **Ask about these** or Copy.
  The Ask panel knows the file and lines (`desk.context`).
- Markdown rendered as a document (full GFM, sanitized, relative links and
  images work), with a Source toggle; a folder's README shows when you open it.
- **Changes**: the file's diff since the last commit, with old/new line numbers.
- Images, audio, video inline; SQLite databases as tables (read-only); other
  binaries as facts + Download.
- **Edit** for small changes (Ctrl S saves; if something else, like an agent,
  changed the file meanwhile you choose: keep editing, load theirs, overwrite).
- Open in VS Code, Cursor or Zed over SSH for real editing.

Choice of parts (measured): prism-code-editor (≈5 KB for the viewer, +1–4 KB
per language, +13 KB to edit) and marked + DOMPurify (25 KB) over CodeMirror 6
(125–150 KB) or Monaco (≈5 MB): viewing is the main job, it works on phones,
and it's themable from our CSS variables. They're kit features (`ui.codeBlock`,
`ui.editor`, `ui.document`, `ui.highlight`), so any View gets them, and chat
messages get highlighted code. Vendored in `ui/vendor/`, built by
`tools/vendor` (`npm ci && npm run build`); the box needs no npm for them.

API: `views/desk/files.mjs` (`/api/files/*`, runs as the agent user). Raw
files are served with a sandbox CSP so an HTML or SVG file can't run as the
Springroll. `show <file>[:line]` opens a file from the shell.

## Browser

A system View (sidebar → Apps → Browser) with a real browser agents drive and the owner watches.
Agents run `browser start [name] [--profile P]` and then `agent-browser --session <name> …` (Vercel's
CLI: snapshot with @refs, click, fill, read, screenshot); the View streams the page (agent-browser's
screencast, painted on a canvas) and sends the owner's mouse, scroll and keys back, so a sign-in,
2FA code or captcha is a hand-off, not a dead end. Chat on a browser gives it to an agent.

Where the browser runs is a route, set up from the View (Ways to browse): this machine (headless
Chromium, free; sites see the server's data-center address), **home internet** (the same browser
through a second, userspace tailscaled that exits at a device in the owner's home, so sites see
their home address; nothing else on the machine is routed; checked before and every 3 minutes
during use), or a cloud browser (Kernel, Browserbase; keys in Keys). `browser start` follows the
owner's settings: home first, their fallback for signed-out browsing; a profile (sign-ins) never
leaves home. Profiles live in `~/.config/springroll/browser/`, encrypted in backups.
`skills/web` tells agents which tool and route to use; `views/browser/README.md` has the API.

## Design system

Kit v2 (`views/desk/public/ui/`): Springroll's quiet language. Seven-color
themes (20 incl. Springroll light/dark, every one contrast-checked), derived
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
