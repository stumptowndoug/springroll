# Springroll changelog

What changed upstream, written for the agent that merges it into a machine
(see `skills/update/SKILL.md`). Newest first. Each entry: what and why, the
files, and **If you changed this**: how to carry the idea over when this
machine has its own version of those files.

## 2026-10-10 · Gmail: several accounts; app passwords or Sign in with Google

- **What:** Connections → Gmail is a list of accounts (`views/desk/google.mjs`, `/api/google…`,
  stored in `~/.config/springroll/google.json`, mode 600). Each account signs in with an **app
  password** (the default; tested before it's saved) or, when an account can't make one, **Sign in
  with Google** through the owner's own OAuth client (Web client, redirect
  `<springroll address>/api/google/callback`, scope `https://mail.google.com/`; IMAP over XOAUTH2).
  The old single-account `~/.config/springroll/gmail` moves into it on first read.
- **Mail** (template `mail`; this machine's `views/mail`): `sync.py` reads every account (one failing
  doesn't stop the rest), schema 2 tags mail by account (the local copy is a cache of Gmail, so an
  old schema is dropped and refilled once: expect a fresh 30-day download). `server.py` adds
  `account` to the API and `accounts` (with errors) to `api/status`; the page gets an account picker
  and an account label once there are two or more.
- **Elsewhere:** Keys lists "Gmail accounts" as a sign-in Springroll keeps; agentd masks app
  passwords, refresh tokens and the client secret in timelines. The catalog's `gmail` entry has
  `"accounts": true` instead of key fields.
- **Migration:** restart desk and the mail service (`systemctl --user restart mail`), run
  `systemctl --user start mail-sync`, check `journalctl --user -u mail-sync -n 20` and Mail.
- **If you changed this:** if this machine's Mail was changed, keep the owner's changes and fit the
  account column in (API field `uid` is now Mail's own id).

## 2026-10-10 · Claude usage: stop re-triggering the rate limit

- **What:** Anthropic's usage endpoint (`/api/oauth/usage`) answers 429 with `retry-after`, and a call
  during the lockout seems to start it over. The meter honored retry-after only in memory, so every
  desk restart called again at once. `views/desk/usage.mjs` now keeps its state in `~/.desk/usage.json`
  (last good numbers, next allowed check, failures in a row), waits at least what's asked (+10%,
  min 15 minutes) and doubles that for each 429 in a row, to 6 hours. The sidebar tooltip says when
  the next check is and keeps showing the last good numbers.

## 2026-10-10 · Templates moved from Settings to All apps

- **What:** Settings' Templates section is gone. All apps (`app/apps.js`) shows templates not yet
  installed under "Ready to add" (only when there are any), each with Add / Add and set up (same
  `POST /api/templates/<name>/add` as before). The All apps header's Templates button is gone.

## 2026-10-10 · Fix: the nightly backup failed (exit 2) after the rename

- **What:** `bin/backup`'s rotation listed `springroll-*.tar.gz` and `agentos-*.tar.gz`; with no old
  `agentos-*` files left, `ls` failed on the literal pattern and `set -o pipefail` failed the run
  after the backup had been written. Rotation now uses `nullglob` and only prunes past `--keep`.

## 2026-10-10 · Apps that failed to load recover instead of staying blank

- **What:** Springroll keeps each app's frame alive between visits. A frame whose load failed (the
  desk restarting during an update, a network blip) stayed blank until the whole tab was reloaded,
  e.g. Home's "Set a backup passphrase" → Settings showed a white page. Now a failed load retries
  (4 times, backing off), and opening an app whose kept frame is broken loads it again.
  `app/main.js` (`frameOk`, `frameFor`, route).

## 2026-10-10 · Reports can be turned off per job; no duplicate closing message

- **What:** job.json takes `"report": false` (default on; a switch in the job editor, agent jobs
  only). Off, the run prompt asks for a final message instead of a report, no report is stored, and
  the job's runs open as their chat. On, the prompt now says the report shows at the end of the chat,
  so the closing message is one short line, not a recap; and a run's chat hides a closing message
  identical to the report (the case where the final message became the report). The update skill's
  step 6 publishes the report with `report` and ends with one line.
- **Files:** `agentd/jobs.mjs` (prompt, `report` field), `agentd/server.mjs`, `app/jobs.js`,
  `app/home.js`, `app/thread.js`, `skills/update/SKILL.md`.

## 2026-10-10 · A run's chat: job pointer on top, report at the end

- **What:** in a job run's chat, the job's prompt is no longer the first message: it's a one-line
  pointer ("Morning brief · Scheduled run · Show prompt"; the job links to its page, the prompt
  expands in place). Once the run has a report, it shows at the end of the chat (`.chat-report`,
  rendered with Rollmark, "Open" goes to the run page), so watching a run live ends in the same
  report the run page shows. `app/thread.js`, `app/thread.css`. Morning brief's prompt says "Home"
  (was "Today"); the update skill screenshots Home.

## 2026-10-10 · Job runs are reports (Rollmark)

- **What:** a job run is read as a report, not a chat. The run page (`#/r/<thread id>`, `app/run.js`)
  shows the date, the report's title, one line of links (status and time, the job, "See the work" =
  the run's chat) and the report, rendered with Rollmark (Springroll's report format: Markdown plus
  ```chart and ```mermaid blocks) in the theme's colors. Runs, Home's routine runs, a job's run list
  and failed-run cards open it; a run's chat has a "Report" link back.
- **Publishing:** new `bin/report` (`report [--title T] [file|stdin]`, inside a job run; publish
  again to update). agentd stores it on the run (`runs.report`, `runs.title`; `POST /runs/report`,
  `GET /runs/thread/<id>`); with no report, the run's final message becomes it. The run's title,
  preview (first paragraph) and notification come from the report.
- **Writing them:** new `skills/report/SKILL.md` (lead with the result, data as a table or chart,
  no process; long work reports where it stands and publishes again) with Rollmark's format rules
  verbatim. The job prompt now points at it instead of "end with the result".
- **Rendering:** `@stumptowndoug/rollmark` 0.1.3 bundled into `ui/vendor/rollmark.js` (Mermaid
  11.17.2 split out, loaded only for diagrams) by `tools/vendor`; `ui.report(el, source)` in the kit
  (`.ui-report` styles) for any app that wants to show one.
- **Migration:** link the new skill for every agent (the update skill's step), restart agentd (after
  the merge) and desk. Old runs have no report: their page shows the run's summary.

## 2026-10-10 · Jobs and connections update live when files change

- **What:** a job created or edited by writing `jobs/<name>/job.json` (the usual way for agents) was
  invisible to agentd until it restarted: not on the Jobs page, and **not scheduled**. agentd now
  watches `~/home/jobs` (`Jobs.watch` in `agentd/jobs.mjs`: `fs.watch` plus a 15s check), re-plans
  and tells open pages. The desk server notices changes to `connections/` and
  `~/.config/springroll/` (every 2s, like apps) and sends a `connections` event; Connections and
  its sidebar dot refresh. `views/desk/server.mjs`, `app/api.js`, `app/connections.js`, `app/main.js`.
- **Migration:** restart agentd (after the merge) and desk.

## 2026-10-10 · Less flicker

- **Icons:** `ui.icon` / `ui.agentMark` no longer point at `/ui/icons.svg#x` (a browser paints an external
  `<use>` a frame late, so menus and re-renders blinked). `kit.js` loads the sprites once and copies
  each symbol into a hidden `<svg>` in `<head>` the first time it's drawn (`#ui-icons-<name>`,
  `#ui-logos-<id>`); anything drawn before the sprites load is switched over. Apps get this too.
- **Theme on load:** `desk.js` keeps the last appearance in localStorage and applies it before the
  first paint (pages and apps no longer flash the default theme); `custom.css` loads in the head.
- **Opening a chat** keeps the current chat on screen until the new one arrives; a spinner shows only
  if that takes over 300ms (`app/thread.js` `open`).
- **Pages update in place:** Home, Jobs, Chats, Connections and All apps use `ui.morph` instead of
  replacing their HTML, so unchanged parts don't redraw and text being typed (Home replies, key
  boxes) survives a refresh.
- **If you changed this:** in your own Views, prefer `ui.morph(el, html)` over `el.innerHTML = html`
  for anything that re-renders.

## 2026-10-10 · Browser tab icon: the plain leaf

- **What:** the browser tab uses `views/desk/public/favicon.svg`, Springroll's leaf alone in
  Springroll green (lighter in dark mode), instead of the app icon on its tile. The installed-app
  and home-screen icons (`icon.svg`, `icon-*.png`, the manifest) are unchanged.

## 2026-10-10 · Connections in the sidebar, with Keys

- **What:** Connections is a top sidebar item (Home, Chat, Jobs, Connections) with a warn dot when a
  connected service fails its check or an agent is waiting for a key. Its page has two tabs:
  **Services** (as before) and **Keys** (`#/connections?tab=keys`): every `NAME=value` secret with its
  last four characters, note, the connection it belongs to and which apps/jobs use it; Add, Reveal,
  Replace, Delete (keys owned by a connection are removed by disconnecting it); keys agents asked
  for, with a paste box; and the sign-in files Springroll keeps (read-only). Settings' Connections
  section is gone.
- **Agents ask, never get keys in chat:** new `bin/secret` (`request|get|list|has|set`).
  `secret request NAME "why"` posts a Home "Needs you" card (signal key `secret:NAME`) with a paste
  box; saving it (`POST /api/secrets`) clears the card and tells the asking chat it's ready.
  `views/desk/secrets.mjs` + `/api/secrets` (`GET`, `POST {name,value,note}`, `POST /<NAME>/reveal`,
  `DELETE /<NAME>`). Notes and dates: `~/.config/springroll/secrets.json`. Values stay in `secrets.env`.
- **Masking:** agentd replaces key values (8+ characters, from `secrets.env`, the Claude token, the
  Gmail app password, the backup passphrase) with `••••NAME` in everything it stores: timeline
  items, previews, errors (`store.setRedactor` in `agentd/server.mjs`).
- **AGENTS.md:** Connections explains Keys and says never to ask for keys in chat; Commands lists `secret`.
- **If you changed this:** if this machine's Settings still links Connections, point it at `#/connections`.

## 2026-10-10 · Model and effort pickers on a new chat

- **What:** a new chat shows the Model and Effort pickers before the first message. agentd remembers
  what each agent offered at its last session start (`agent_options` table, filled on connect and,
  once, from each agent's latest chat) and serves it at `GET /agents/<id>/options`. The new chat
  sends `model` and `effort` with `POST /threads`; agentd applies them as the session starts.
  `agentd/store.mjs`, `agentd/threads.mjs`, `agentd/server.mjs`, `app/thread.js`. An agent that has
  never had a chat still shows no pickers until its first one.

## 2026-10-10 · Home's "The box" uses the Utilization bars

- **What:** Memory, Disk and CPU on Home use the same bar as the sidebar's Utilization (`.usage-bar`:
  8px, tinted track, bold %). Color is how full: green, amber from 70%, red from 90%. A tick on
  Memory marks its 24-hour peak (hover for when). `app/home.js` `renderBox`, `app/pages.css` `.meter`.

## 2026-10-10 · Sidebar chats: the latest four, then All chats

- **What:** the sidebar's Chats shows the four most recent chats, plus any that need you or are
  working, then **All chats** (`#/chats`, `app/chats.js`) with how many more there are. All chats:
  search (titles and messages), Current / Archived, grouped by day, the same ⋯ menu. The **+** in
  the Chats header starts a new chat; the archive toggle moved to the page. The launcher has
  "All chats". Utilization hides when no agent reports usage.

## 2026-10-10 · Utilization meter like Shep's; agent logos keep their real colors

- **What:** the sidebar corner is a **Utilization** section (a `.side-sec`, styled like Apps and Chats): one row per plan window (agent logo,
  an 8px bar, % used). A tick marks how much of the window has passed, and the bar's color is
  the pace (theme `--ok` / `--warn` / `--danger`): under pace, past half or ahead of pace, nearly
  out. Rows sort over-pace first. Hover a row for Used, Remaining, Pace, Window elapsed, Resets
  in; click for every window. `app/main.js` (Utilization), `app/app.css` (.usage*).
- **Logos:** `.ui-logo` is black in light themes and white in dark ones (`kit.css`), not the
  theme's text color, so black-and-white marks (Codex, OpenCode, Pi, Cursor) look like
  themselves in tinted themes. Claude and Gemini keep their brand colors.

## 2026-10-10 · The last "agentos" names are now "springroll"

- **What:** internal names follow the product name.
  - `~/.config/agentos/` → `~/.config/springroll/` (keys, sign-ins, env, seed path)
  - `bin/agentos-upstream` → `bin/springroll-upstream`
  - `jobs/agentos-update` → `jobs/springroll-update`
  - `AGENTOS_THREAD` → `SPRINGROLL_THREAD`; `AGENTOS_BACKUP_PASSPHRASE` → `SPRINGROLL_BACKUP_PASSPHRASE`
  - backups are `springroll-<host>-<date>.tar.gz`
  - `/opt/agentos-seed` → `/opt/springroll-seed`; `~/.agentos` → `~/.springroll` inside Sprites
  - the ACP client name is `springroll`
- **Still works:** old `agentos-*.tar.gz` backups are listed, kept by rotation and restorable. `restore`
  moves secrets from an old backup's `.config/agentos` into `.config/springroll`. `signal` and
  `restore` accept the old variable names. agentd moves the old job's runs, run threads and Home
  signals to `springroll-update` on start (`Jobs.migrateNames`).
- **Migration** (idempotent; on the reference machine it was already done before this update):

      if [ -d ~/.config/agentos ] && [ ! -L ~/.config/agentos ]; then mv ~/.config/agentos ~/.config/springroll && ln -s springroll ~/.config/agentos; fi
      sed -i 's#\.config/agentos#.config/springroll#g' ~/.config/springroll/env ~/.bashrc

  Then restart agentd (after the merge, as the skill says) and desk.
- **If you changed this:** if this machine's own code or LOCAL.md mentions any of the old names, rename them too.

## 2026-10-10 · Real coding-agent logos

- **What:** `views/desk/public/ui/logos.svg` has the agents' real marks
  (from the Shep app's assets): Claude in its orange, Codex (OpenAI),
  OpenCode (two-tone), Pi, plus Gemini, Grok and Cursor for later. One-color
  marks use currentColor, so they follow light and dark themes. `kit.js`
  `LOGOS` lists the new ids. Use them with `ui.agentMark(id)` as before.

## 2026-10-10 · Apps and Home; sidebar choice; agent usage

- **Names:** owner-facing "Views" are **apps** ("Apps" in the sidebar, "All
  apps", "Build an app"); "Today" is **Home** (nav, heading "Home.", launcher,
  Ctrl+0). Settings' "Views" section (starting points) is **Templates**; the
  "Today" section is **Home**. Internal names are unchanged (`views/`,
  `/v/<name>/`, `window.desk`, `home.js`). AGENTS.md: "## Apps (the `views/`
  folder)", "## Home"; agents say "app" to the owner.
- **Sidebar choice:** `desk.json` `sidebarApps` ({name: true|false}) decides
  which apps sit in the sidebar; default is shown unless the app folder has a
  `.placeholder` file (new: `views/calendar/.placeholder`,
  `views/todos/.placeholder`). Each sidebar app has ⋯ → Hide from sidebar; the
  sidebar ends with **All apps** (`#/apps`, `app/apps.js`) where a switch per
  app puts it back. The sidebar's + opens All apps.
- **Agent usage:** `views/desk/usage.mjs` + `GET /api/usage`: each signed-in
  agent's plan windows (Claude: `api.anthropic.com/api/oauth/usage` with the
  CLI's OAuth token or `CLAUDE_CODE_OAUTH_TOKEN`; Codex:
  `chatgpt.com/backend-api/wham/usage` with `~/.codex/auth.json`). Cached 5
  minutes, honors Retry-After. Shown in the sidebar's bottom-left (one bar per
  agent, its most-used window); click for every window, what's left and when
  it resets.
- **If you changed this:** if this machine renamed things itself, keep the
  owner's words. If the owner already built a real Calendar or To-dos, delete
  the new `.placeholder` file in that folder so it stays in the sidebar.

## 2026-10-09 · Today: "Upcoming jobs"

- **What:** the side column's "Coming up" is "Upcoming jobs" with the Jobs
  icon in its heading, and "The box" has the System View's icon (it only lists jobs); rows no longer carry an icon each.
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
