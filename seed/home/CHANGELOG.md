# Springroll changelog

What changed upstream, written for the agent that merges it into a machine
(see `skills/update/SKILL.md`). Newest first. Each entry: what and why, the
files, and **If you changed this**: how to carry the idea over when this
machine has its own version of those files.

## 2026-10-09 · Today: "Upcoming jobs"

- **What:** the side column's "Coming up" is "Upcoming jobs" with the Jobs
  icon in its heading (it only lists jobs); rows no longer carry an icon each.
  `app/home.js` `renderNext`, `app/pages.css`. When calendar events join this
  list, rename it back and give each kind its own icon.

## 2026-10-09 · Close every run left "running", not just the latest

- **What:** `Jobs.closeStale` (`agentd/jobs.mjs`) now closes every run still
  marked running that agentd isn't running, including older ones behind a
  newer run. It only posts to Today when the cut-off run is the job's latest.

## 2026-10-09 · Failed runs go on Today; no more runs stuck "running"

- **What:** a run cut off by an agentd restart stayed `running` forever (Jobs
  showed it running; Today ignored it). On start, agentd now closes such runs
  as failed ("Stopped partway: the agent service restarted during the run").
  Every failed run now posts a `needs` signal keyed `job:<name>`
  (`agentd/jobs.mjs` `closeStale`, `failed`); the next good run clears it.
  Today renders these with a reply box for agent jobs (tells the run's agent
  what to do next), Run again, Ask an agent (command jobs: a new chat to find
  and fix the cause), Open run, Not needed. Today no longer derives failure
  cards from job state.
- **Today:** with no weather place set, the side column asks for a ZIP code or
  city inline (saved to `desk.json` `weatherLocation`); Coming up rows show
  the Jobs icon and the heading links to Jobs.
- **Migration:** restart agentd (see the update skill: after the merge). Old
  stuck runs are closed and shown on Today once; dismiss them with "Not
  needed" if they're already handled.

## 2026-10-09 · Update skill: restart agentd only after the merge

- **What:** `skills/update/SKILL.md` step 5 now says to schedule the agentd
  restart after `git merge --ff-only` into `main`, as the last command.
  Twice the restart fired while the update was still on its branch, so
  agentd came back running the old code.

## 2026-10-09 · Cron: 7 means Sunday only in the weekday field

- **What:** `agentd/cron.mjs` turned a 7 in *any* field into 0, so
  `0 7 * * *` ran at midnight and `7 17 * * *` at 17:00. Now only the weekday
  field accepts 7 (Sunday), including in ranges like `1-7`.
- **If you changed this:** if this machine already fixed it locally (a
  LOCAL.md line about cron 7=Sunday), take upstream's version and drop that
  LOCAL.md line.

## 2026-10-09 · Today is a focus page; signals

- **What:** Today (`views/desk/public/app/home.js`, `pages.css` "Today") is
  rebuilt around three levels: **Needs you** (waiting approvals with the
  command and Allow/Deny right there, questions with an inline reply, failed
  jobs with Run again, sign-in/setup/passphrase), **Worth knowing**
  (signals, dismissable), and a single "N routine runs in the last day, all
  fine" line that expands to the runs. A side column holds weather, Coming
  up and The box (System View's numbers and 24 h memory peak). When nothing
  needs the owner it says "Nothing needs you." The Views tiles are gone from
  Today (they're in the sidebar). The sidebar's Today gets a warn dot while
  anything needs the owner.
- **Signals** (new): agentd keeps a `signals` table (`agentd/store.mjs`) with
  `GET/POST /signals`, `POST /signals/<id>/dismiss`, `POST /signals/clear`
  (`agentd/server.mjs`). Levels: `needs`, `notable`, `brief`. New command
  `bin/signal`. Agents get `AGENTOS_THREAD` in their environment (chats and
  command jobs) so a signal links back to its thread. A job run whose final
  paragraph is a question becomes a `needs` signal; the owner replying in
  that thread clears it.
- **Morning brief** (new job, `jobs/morning-brief`, 7:00 daily): an agent
  writes 2–3 sentences with `signal --brief`.
- **Weather:** `GET /api/weather` in `views/desk/server.mjs` (Open-Meteo, no
  key, cached 20 min) for the place in `desk.json` `weatherLocation`, set in
  Settings → Today.
- **System template:** the watchdog also posts a signal (`key
  system:watchdog`) with the agent's report. Copy `signal()` and its two
  calls from `templates/system/server.py` into `views/system/server.py`.
- **Fix:** `store.updateThread` ignores undefined fields. Before, a turn
  that errored before any text crashed agentd (SQLite can't bind undefined).
- **Kit:** `.ui-sr-only` (visually hidden labels).
- **Migration:** restart agentd and desk. The `signals` table creates itself.
  Ask the owner where they live for weather if `weatherLocation` is unset
  (or leave weather off). The morning brief job is enabled. If the owner
  doesn't want a daily agent run, disable it.
- **If you changed this:** if this machine's Today (`home.js`) has its own
  sections, keep them and fit them into the three levels (blocking → Needs
  you; news → a signal; ambient → the side column). Keep `runFeed` and
  `nextLabel` exported; Jobs imports them.

## 2026-10-10 · Springroll themes are the defaults

- **What:** the System theme follows Springroll Light / Springroll Dark; the
  Indigo Light/Dark themes (ids `agentos-light`, `agentos-dark`) are removed.
  The kit's fallback accent (before settings load) is Springroll green.
- **Migration:** if `desk.json` names `agentos-light` or `agentos-dark`, the
  app falls back to System; set `springroll-light` / `springroll-dark` instead
  if the owner had picked one of those on purpose.

## 2026-10-10 · The name is Springroll

- **What:** "AgentOS" and "the Desk" are now **Springroll** in everything the
  owner reads: the sidebar brand (Springroll's leaf mark, `ui/logos.svg#springroll`,
  in the accent color), page titles, the installed-app name and icons
  (`icon.svg`, `icon-256.png`, `icon-512.png`), Settings, AGENTS.md, DESIGN.md,
  docs, comments. The Indigo themes were "AgentOS Light/Dark" (ids unchanged).
  The context marker agents see is now `[Context from Springroll]`.
- **Unchanged on purpose:** internal names and paths (`views/desk/`, `desk.js`,
  `window.desk`, `~/.config/agentos/`, `agentos-upstream`, the
  `jobs/agentos-update` folder, `AGENTOS_*` variables, systemd unit names).
- **If you changed this:** rename the owner-facing text in your own versions
  of these files too; keep the owner's own wording where they chose it.

## 2026-10-10 · Corner button: "Chat", in the accent

- **What:** the bottom-right button reads "Chat" with a message icon, uses the
  accent color, and no longer shows its shortcut (Ctrl+. is listed in
  Settings → Keyboard). `app/main.js` (fab), `app/app.css` (.ask-fab).

## 2026-10-10 · Sidebar: Today, Chat, Jobs; chat on every page

- **What:** the sidebar's top is Today, Chat (new chat) and Jobs; Settings
  (gear) sits top left next to the brand, and Connections is a section of
  Settings (the page stays at `#/connections`, with a back link). Files and
  Terminal are listed with the Views; Calendar and To-dos are placeholder
  Views (`views/calendar`, `views/todos`). Today has no message box: the
  bottom-right Ask button is on every page except chats and passes the page as
  context (`{key, title, page}` for Springroll pages; agentd's contextText says
  "Springroll's … page"). Today's feed is job runs; Jobs has a Runs tab
  (`#/jobs?view=runs`). The `/` key opens the Ask panel where there's no composer.
- **If you changed this:** keep your own sidebar entries; if you replaced
  Today, drop the composer there only if the owner agrees. Placeholder Views
  you've already built for real (calendar, todos) win: skip ours.

## 2026-10-09 · Fly Sprites for heavy work

- **What:** a Fly Sprites connection (Connections → Compute: token, installs the
  `sprite` CLI), `bin/sprite-job` (detached long runs that hold the Sprite
  awake) with `bin/sprite-run` (its in-Sprite half), `skills/sprites`, and a
  "Heavy work" section in AGENTS.md.
- **Why:** keep this machine small; heavy or long work runs on a per-project
  cloud computer that sleeps when idle.
- **If you changed this:** take the skill and scripts; link the new skill
  (step 5 of the update skill).

## 2026-10-09 · Agent-run updates

- **What:** this file, `bin/agentos-upstream`, `skills/update/SKILL.md`, the
  weekly `jobs/agentos-update` job, and `LOCAL.md` (how this machine differs
  from stock). AGENTS.md has a new "Updates" section.
- **Why:** each machine is the owner's own fork; its agent keeps it current by
  merging upstream with judgment instead of the owner doing merges.
- **If you changed this:** keep your job schedule; take the skill and script.

## 2026-10-09 · Chat stops flashing while streaming

- **What:** `ui.morph(el, html)` in `ui/kit.js` updates only nodes that changed.
  `app/thread.js` (timeline turns, header, working line, approvals, composer
  footer) and `app/main.js` (nav, Views, chat list) use it instead of innerHTML.
- **Why:** every streamed chunk recreated every icon and restarted every
  animation (259 icons recreated in one short chat, now 7).
- **If you changed this:** use `ui.morph` anywhere your version re-renders on
  live updates. Don't morph an element the owner is typing in.

## 2026-10-09 · Current chat adapters, effort picker

- **What:** `agents/agents.json` uses `@agentclientprotocol/claude-agent-acp`
  (command `claude-agent-acp`) and `@agentclientprotocol/codex-acp`; the old
  `@zed-industries/*` packages are deprecated and their model lists frozen.
  agentd prefers the adapter's `model` config option, adds `options.effort`
  (thought_level) with `PATCH /threads/:id {effort}`, an `effort` column, and
  Codex's full mode `agent-full-access`. The composer has an effort picker.
- **Migration (run once):** `npm rm -g @zed-industries/claude-code-acp @zed-industries/codex-acp; npm i -g @agentclientprotocol/claude-agent-acp @agentclientprotocol/codex-acp`,
  then restart agentd (scheduled, see the skill).
- **If you changed this:** keep your agents.json additions; update the `acp`
  and `acpInstall` fields of claude and codex.

## 2026-10-09 · Agent logos, no icon backgrounds

- **What:** `ui/logos.svg` and `ui.agentMark(id, name)`; letter circles replaced
  in the composer, pickers, thread header and Settings. Icons never sit on a
  tile or chip (DESIGN.md rule); `.conn-icon`, `.tile-icon`, `.need-icon` are plain.
- **If you changed this:** the owner asked for plain icons; respect that in your version.

## 2026-10-09 · Sign in with GitHub

- **What:** Connections can sign in with a service's own CLI (catalog
  `signin`: needs, install, command, test, after, logout). GitHub uses
  `gh auth login --web`; Springroll relays the device code. Backups include
  `~/.config/gh/hosts.yml` and `~/.gitconfig`.
- **If you changed this:** merge the `signin` block into your catalog's github entry.

## 2026-10-09 · Files

- **What:** the Files View (`views/files/`), Springroll's files API
  (`views/desk/files.mjs`), kit helpers `ui.codeBlock`, `ui.editor`,
  `ui.document`, `ui.highlight` with vendored libraries in `ui/vendor/`,
  `desk.context()` / `desk.discuss()`, `show <file>[:line]`, Ctrl P.
- **If you changed this:** Files is a system View; keep it in the sidebar's NAV.
