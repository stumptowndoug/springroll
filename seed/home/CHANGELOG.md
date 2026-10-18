# Springroll changelog

What changed upstream, written for the agent that merges it into a machine
(see `skills/update/SKILL.md`). Newest first. Each entry: what and why, the
files, and **If you changed this**: how to carry the idea over when this
machine has its own version of those files.

## 2026-10-18 · Running is a status, not a pill

- **Running** shows like every other status: a pulsing `--run` dot, the word, and how long it's been
  going in mono ("● Running 47m"). One helper makes it: `ui.running(startedAt, label?)` (and
  `ui.elapsed(t)`) in `ui/kit.js`; the time is left out when there's no start. The tinted
  `.ui-pill.run` is gone from `ui/kit.css`, so nothing can bring the old tag look back.
- Used in Jobs (list rows and the job page heading; a running job's start is its current run,
  `j.last.started`), System (`templates/system`: Paused) and the Gallery. Paused and Queued drop their
  pills too: a dot and a word.
- **Only Needs you keeps a tinted pill** (`ui-pill attention`), so the one colored shape on a page is
  the one asking for the owner. DESIGN.md says so.
- Why: the owner found the tinted tag out of place beside every other status, and picked this from
  six options on the owner's machine.
- **If you changed this:** any app of your own using `ui-pill run` (or a plain `ui-pill` for a
  state) loses its tint: switch it to `ui.running(startedAt)` or
  `<span class="ui-status"><span class="ui-dot …"></span>Word</span>`. `grep -rn "ui-pill" ~/home/views`
  finds them. An installed System app is a copy of the template: make the same one-line change there.

## 2026-10-16 · Email asks first by default; migrations; installer re-runs keep folders usable

- **Email: "Ask me first" is the default** (`views/desk/google.mjs`, `app/connections.js`, `bin/gmail`,
  AGENTS.md): until the owner picks "Send right away" in Connections → Gmail, agents show the exact
  email in the chat and send only after a yes (`--approved`). A saved choice is kept, so a machine
  whose owner picked Send right away is unchanged; one that never chose now asks first. Say so in
  the update report.
- **Migration** (machines that took the Timeline update below; run each, they're safe to repeat):
  - Claude's own auto memory off, now that `notes/memory.md` is the memory:
    `f=~/.claude/settings.json; jq -e 'has("autoMemoryEnabled")' $f >/dev/null || { jq '.autoMemoryEnabled=false' $f > $f.tmp && mv $f.tmp $f; }`
  - The To-dos app's server: `systemctl --user link ~/home/views/todos/todos.service && systemctl --user enable --now todos`
  - Folders under `~/.config/springroll` back to 700 (an installer re-run had made them 600, which
    breaks the Browser app's profiles, ssh keys and home internet): `find ~/.config/springroll -mindepth 1 -type d -exec chmod 700 {} +`
- **Installer:** the last step chmod-ed everything in `~/.config/springroll` to 600, folders too, so
  re-running `install.sh` (a restore, a repair) broke the browser ("EACCES … profiles/default").
  Files get 600, folders 700, and a re-run repairs them. Found by updating a test box.
- `tests/fresh-install.sh` opens a page again after the re-run, so this can't hide behind the last check.
- **If you changed this:** nothing to carry over; run the migrations.

## 2026-10-16 · Timeline, Keys, memory and personas, background work, skills, To-dos

Ported from the owner's machine, where each piece ran for a few days first. Big: read the parts
your machine has its own version of. On a machine that never changed these files, it's a clean merge.

- **Timeline replaces Home** (`views/desk/public/app/timeline.js`, was `home.js`; `main.js`,
  `pages.css`, `jobs.js`, `run.js`, `agentd/server.mjs`, `store.mjs`): one feed of everything on the
  box. What waits on the owner leads Today, then running and queued runs, then each day's job runs and
  worth-knowing signals, each with a source tag (`ui-tag`). Search, filters and an Upcoming view
  (next week's scheduled runs, `/api/upcoming`) sit beside the heading. Jobs lost its Runs tab
  (`#/jobs?view=runs` → `#/`). Each job chooses how much of it reaches the Timeline (`job.json`
  `timeline`: every run / failures / never; reports default to every run, others to failures).
- **Needs you is sorted by a model** (`views/desk/needs.mjs`, `/api/needs…`, Settings → Needs you):
  an agentd session reads the last 36 h (signals, failed runs, reports, triaged mail, machine) and
  returns ranked items with a suggested step; rows get Chat/View/Done and 👍/👎. Approvals, sign-ins
  and key requests stay as they were. Pick the agent, model and how often in Settings.
- **Keys is its own page** (`app/keys.js`, `#/keys`; `#/connections?tab=keys` and `#/vault`
  redirect): reveal switch, Replace/Edit note/Copy/Delete, "used by" with links, JSON keys. Settings →
  Keys "Show values" (`desk.json` `keys.reveal`). Connections is coding agents and services only.
- **Coding agents** (`agents/agents.json`, `bin/agy-acp-install`, `app/connections.js`, `signin.js`):
  every agent optional with Install / Add chat / Remove; Cursor and Antigravity (Google's runtime,
  pinned and checksummed) in chat; click an agent for who it's signed in as. Settings → Coding agents
  sets each agent's default model and reasoning for new chats (`desk.json` `chatDefaults`).
- **Memory and personas** (`notes/memory.md`, `CLAUDE.md`, `agentd/threads.mjs`, `agentd/personas.mjs`,
  `personas/README.md`): one file of what every agent should know about the owner, imported by Claude
  and sent with the first prompt to every other agent; the installer turns Claude's own auto memory
  off. Personas set how the agent talks in a chat (`/persona <id>`, composer menu, Settings default,
  a job's `persona`); voice only. Four starter presets ship (Bourdain, Dolly, Dude, Naval); none is on until the owner picks one, and Settings → Personas creates more.
- **Background work in chat** (`agentd/background.mjs`, `threads.mjs`, `app/thread.js`, `thread.css`):
  Claude's and Codex's backgrounded commands and subagents come from ACP as rows in their turn, with
  a side pane (live output, Stop). Fixes Codex command output, missing since `codex-acp` (it sends
  `_meta.terminal_output_delta`). Idle chats are no longer stopped after 15 minutes
  (`SPRINGROLL_IDLE_MINUTES` opts back in); a job run's agent stops 2 minutes after its turn when
  nothing of it is in the background; the new nightly **housekeeping** job stops abandoned chats.
- **AGENTS.md is short (under 5 KB) and the detail is in skills**: `skills/apps`, `jobs`, `timeline`,
  `connections`, `machine`, `backup`, next to `web`, `sprites`, `orchestrate`, `update`.
  Housekeeping audits skills nightly (`jobs/housekeeping/skills-check.sh`).
- **Off-machine backups, opt-in** (`bin/backup`, `bin/restore`, `skills/backup`, weekly
  `jobs/backup-check`): the nightly snapshot also goes to the owner's bucket with restic when set up.
- **Apps:** the To-dos app is real (`views/todos`, `bin/todo`, service on 8105: a Personal board and
  every `~/projects/*/TODO.md`), with a board component in the kit (`ui.board`). Browser keeps a history
  of every session (`views/browser/history.mjs`, `browser history`). Utilization adds Antigravity
  quotas and per-provider switches (Settings → Utilization).
- **Smaller:** sidebar has one Apps item instead of a per-app list; no "Working" pill in the chat
  header and no suggested-prompt chips; tiles put the icon beside the title; Markdown tables scroll
  instead of squeezing; `gmail --attach`, and `gmail` won't send/archive from the mail-triage job;
  Settings → Appearance uses dropdowns with six text sizes. The morning brief job is gone.
- **If you changed this:** keep your own choices (LOCAL.md says which) and fit these around them. Your
  `home.js` customizations move to `timeline.js`'s feed; a Runs tab you kept becomes a Timeline filter.
  If your AGENTS.md has your own rules, keep them in it and move only the stock detail into the
  matching skill. A morning brief you still want stays as your own job; drop `signal --brief` only if
  nothing reads it. Leave an existing `notes/memory.md` as it is.

## 2026-10-13 · Chat: the agent's narration stays in the chat

- **Narration stays visible:** the agent's text, images, links, notices and approvals stay in the
  conversation in the order they came, instead of folding into the work row when a tool call follows
  them. Each run of thoughts, tools and plans *between* them folds into its own row, with its own
  steps / edits / failed counts. The newest row of a running turn shows the live label and current
  step; earlier rows read "Worked", or "Thought" when they held only thinking. The last row of a
  finished turn reads "Worked for <time>"; delegated agents sit after it, before the answer. Only the
  answer (text after the last row) gets the copy/time row. This also fixes an answer vanishing into
  the fold when the agent ran one more tool after writing it.
- Files: `views/desk/public/app/thread.js` (`turnParts` now returns `segments`; new `renderWork` and
  `renderAgents`), `thread.css`. Work rows are keyed `t<turn>:work:<first item id>`.
- **If you changed this:** split a turn into a sequence of shown items and folded runs rather than
  work/answer by the last tool call, and key each row's open state by its first item.

## 2026-10-13 · Chat: one live work row and reliable following

- **Working → Worked:** thoughts, tools and intermediate narration share one collapsed row from the
  start of a turn. Its summary shows the latest step and counts; finishing relabels the same row and
  keeps the owner's open/closed choice. Answers (including images and links after the last tool),
  notices, approvals, delegated agents and changed files stay outside it. The separate Working line
  shows only until there is work to group. Disclosure clicks are recorded before the next streaming
  frame, so output arriving during a click can't close a row again.
- **Follow output:** the chat stays at the end through content and composer resizing. Scrolling up
  with a wheel, touch, keys or scrollbar pauses following; focusing a control outside the viewport
  does too. Scrolling back to the end, sending, or pressing **Latest** resumes it. Nested tool output
  scrolls independently, as do the full-page chat and side panel. Showing earlier turns preserves
  the reader's position. Each panel removes its observers and listeners when closed.
- Files: `views/desk/public/app/thread.js`, `thread.css`, new `follow-output.js`. Browser checks live
  upstream in `tests/browser/` (Chromium, WebKit, phone layouts and native Chromium touch input).
- **If you changed this:** carry the common live/completed grouping into your timeline, keeping
  answers and requests outside the fold. The follow controller observes the scroller and its content
  wrapper, with a separate Latest button; wire up open, send, earlier-history and panel cleanup.
  Keep your Markdown renderer and long-message limits; those did not change.

## 2026-10-13 · Chat: images, @ files, delegated agents, what changed, quieter failures

Ported from Shep's chat. Most of it is in `views/desk/public/app/thread.js` and `thread.css`, with new
`app/images.js` and `app/mentions.js`, and `agentd/threads.mjs`, `server.mjs`, `store.mjs`. Tests:
`agentd/test/chat.test.mjs` (fake agent: `look`, `delegate`).

- **Attach images** by paste, drop or the paperclip (shown only for agents whose adapter says
  `promptCapabilities.image`; agentd now remembers that per agent, and asks an agent it doesn't know it
  for once). Up to 6, scaled to a 2000px edge. agentd keeps them as files in `~/data/agentd/images/`
  (named by content hash, served at `GET /images/<file>`), stores `images: [{file, mimeType, name}]` on
  the user item, and sends ACP image blocks before the text. Queued messages keep their images.
- **@ mentions:** `@` in the composer lists the chat folder's files (`GET /files?cwd=`: git's tracked
  and unignored files, or a short walk). agentd sends `@path` of a file that exists as an ACP
  `resource_link` in place. The `/` and `@` menus take arrows, Enter and Tab from the text box.
- **Delegated agents (subagents):** agentd opts in to JetBrains AIR's `nativeSubagentSessions` for
  `claude` and `codex` (`SUBAGENT_AGENTS`). A `subagent_spawned` update adds an `agent` item to the
  turn; the delegated agent's own updates (its `sessionId`) become items with `worker: <session>`,
  which the timeline shows inside that agent's row (state, task, time, what it's doing now). Its
  commands, settings and usage never touch the chat's. A permission it asks for names it (`by`).
  Running ones end as `disconnected` when the agent closes or agentd restarts.
- **Changed files:** a finished turn ends with "Changed N files +a −r"; each file opens to its diffs.
- **Edit or Remove** a queued (or not sent) message: `DELETE /threads/:id/items/:item` (only unsent
  user messages), event `removed`.
- **Quieter failures:** a failed tool reads as ordinary work (its verb, a muted "failed", no longer
  forced open, no red). Notices carry their tone in the icon only. Errors and harness notices about a
  limit (rate, usage, quota, 429, overloaded, credits) are warnings; a chat stopped by one shows
  "Limit reached" with a warn dot, not "Error".
- **Edit rows name the file** for every agent: Cursor's "Edit `/abs`", Codex's "Read file '…'",
  Muse's "edit_file: a", or the diff's path for "Editing files".
- **Copy button** on code blocks in answers.
- **If you changed this:** these are additive. A machine with its own composer or timeline styles keeps
  them and takes the new classes (`.c-images`, `.c-attach`, `.u-images`, `.q-acts`, `.code-wrap`,
  `.changes`, `.agent-wrap`/`.row.agent`). A machine whose `agentd/threads.mjs` diverged must carry
  over: streams keyed by owner (`threadId\nowner`), the `worker` routing at the top of `onNotification`,
  `onWorker`/`endWorker`, `saveImages`/`imagePath`, `mentionBlocks`, `removeUnsent`, and
  `readOptions` keeping `images`.

## 2026-10-14 · A real browser for agents, watched (and taken over) in the Browser app

- **Browser app** (`views/browser/`, port 8103): agents start a browser with `browser start` and drive
  it with Vercel's `agent-browser` (`agent-browser --session <name> …`); the app shows it live and
  sends the owner's clicks, scrolls and keys back, so they can sign in, enter a 2FA code or pass a
  captcha and hand it back. Works on a phone. Chat on a browser hands it to an agent.
- **Ways to browse**, set up from the app: **this machine** (headless Chromium, ready out of the box;
  `ensure.sh` installs agent-browser and Chromium when missing), **home internet** (optional, one
  click: a second, userspace tailscaled used only by the browser exits through a device at the
  owner's home, so sites see their home address; checked before and during use, with a fallback for
  signed-out browsing; sign-ins never leave home), **Kernel** and **Browserbase** (cloud browsers;
  Connect opens their connection).
- Sign-ins (browser profiles) live in `~/.config/springroll/browser/`, so backups encrypt them.
- **Connections:** a **Web** category: Brave (moved from AI), **Firecrawl**, **Kernel**, **Browserbase**.
- **`skills/web`**: when to search, scrape (Firecrawl) or browse, which route to use and what it costs,
  and how jobs use the browser. `AGENTS.md` gets a short "The web" section and the `browser` command.
- **Installer** now links and starts the services apps ship with (`views/*/*.service`, not just
  Springroll's own), in the background, as restore already did. A unit that isn't for every machine
  says so with a `Condition` (`tailscale-browser.service` runs only once home internet is set up).
- **`~/.config/springroll/env` sets `XDG_RUNTIME_DIR`** when the shell didn't (`sudo -u`, ssh): user
  systemd and per-user sockets (agent-browser's sessions) are then the same from every shell. The
  installer adds it to new machines; an existing one can add
  `export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}` to that file.
- Files: `views/browser/`, `bin/browser`, `skills/web/SKILL.md`, `connections/catalog.json`,
  `AGENTS.md`, `install.sh`, `tests/fresh-install.sh`.
- **If you changed this:** a machine that already built its own Browser app (this is where it came
  from) keeps its `LOCAL.md` line and takes these files as they are. Never put launch options in
  `~/.agent-browser/config.json`: `connect` would launch a browser of its own instead of attaching.

## 2026-10-12 · A tidier chat composer; chats always start in ~/home

- **Settings button** is the gear (`settings`, the same icon as Settings in the sidebar) instead of
  sliders.
- **Taller text box:** starts at 64px (was 50px), grows to 280px (was 240px).
- **One size for the button row:** agent and model, settings, Send and Stop are all 30px with 16px
  icons. The composer's icons were 12px (the kit's `.ui-combo` size) next to a 32px Send.
- **No Queue button** while the agent is working: just Stop. Enter still queues a message.
- **Menus show names only:** no descriptions under models, the agent's settings or access (and no
  maker under agents). An agent that can't chat yet still says why.
- **No Folder picker:** a chat started in a project folder doesn't load `~/home/AGENTS.md` (the
  Springroll rules), and the folder never limited access. Chats start in `~/home` and work on
  projects from there; `#/new?cwd=…` links and jobs' "Works in" still pick a folder. `AGENTS.md`
  ("How you're running", "Coding work and other agents") says so.
- Files: `views/desk/public/app/thread.css`, `thread.js`, `AGENTS.md`.
- **If you changed this:** a machine with its own composer styles keeps them; take the folder change
  and the `AGENTS.md` wording anyway.

## 2026-10-12 · OpenCode chats start on a model you're signed in to

- **The bug:** OpenCode lists the models of its own service, OpenCode Zen, whether or not you've signed
  in to Zen, and starts on one of them (`opencode/big-pickle`). Signed in to only OpenRouter (say),
  every new OpenCode chat retried "Invalid credential" and never answered, and the model menu mixed
  usable models with ones that can't work.
- **The fix** (`agentd/threads.mjs` `usableModels`, `agents/agents.json` `providerAuth` and
  `preferModels` on OpenCode, documented in `agents/README.md`): for an agent with `providerAuth`, chat
  offers only the models of providers with a key (in its auth file, its config, or
  `<PROVIDER>_API_KEY` in the environment). If it starts on any other model, a new chat switches to the
  newest Claude Sonnet it has (then GPT-5, Gemini 3 Pro; else the first usable one), and the composer
  shows that before the first message. A model the owner picks is still what new chats start on.
  Nothing is hidden when no provider has a key. Test: `agentd/test/chat.test.mjs`.
- **If you changed this:** a machine that worked around it by setting `model` in
  `~/.config/opencode/opencode.json` can keep it (a usable model there is left alone). A machine with
  its own `agents.json` adds the two OpenCode fields.

## 2026-10-11 · Narrower pages; nothing sits under the Chat button

- **Pages are narrower:** `--page-width` 1080px → 960px (`ui/theme.css`).
- **The floating Chat button never covers content** (`ui/kit.css`, `app/app.css`, `app/main.js`,
  `index.html`):
  - `.ui-page` is centered as before, but its right margin is at least `--fab-room` (120px where the
    button shows; the gutter elsewhere), so on narrower windows content stops short of the button.
  - Apps in a frame: one built on the kit's `.ui-page` gets `--fab-room` set inside it (same lane);
    any other (full-width, like Mail and Files) gets its frame shortened by 76px (`.fab-band`) so the
    button sits below it (`fitFrame`).
  - The Terminal page has no floating button (a full-screen tool).
  - Phones: the floating button is gone; **Chat about this page** is an icon in the top bar
    (`#mobileChat`), next to New chat.
- **If you changed this:** a View that draws its own full-width layout and wants the space back can use
  `.ui-page`; one that changed `--page-width` keeps its value.

## 2026-10-11 · Sign in where you need it: Connections, Home, a new chat (and on Sprites)

- **One sign-in panel, opened from anywhere** (`views/desk/public/app/signin.js`: `signinPanel(el,
  agent, {sprite, onDone})`, `openSignin(agent)` as a dialog, `terminalSetup(agent)` for agents that sign
  in through menus). It runs the agent's login (installing it first if needed) and shows the sign-in
  page, a code to enter there, or a box to paste the page's code back, and finishes by itself.
- **Connections → Coding agents** (first section): every agent with its plan (`plan` in
  `agents.json`), status and **Sign in**. Connections is now "everything this machine signs in to".
  **Settings → Coding agents** keeps only the default chat agent (a select) and points to Connections.
- **Home:** "Sign in to <default agent>" and any `needs` signal with key `signin:<agent>[@<sprite>]`
  get a **Sign in** button that opens the steps in the row; finishing clears the signal. A local
  `signin:<agent>` item hides once that agent is signed in anywhere.
- **New chat** with an agent that isn't signed in (or lacks its chat adapter): a card above the composer
  signs in right there; a message sent meanwhile waits and goes once signed in. The agent picker no
  longer sends you to Settings.
- **Terminal "+"** with an agent that isn't signed in: signs in first, then opens the session.
- **On a Sprite:** `POST|GET|DELETE /api/agents/:id/signin?sprite=<name>` runs the login there with
  `sprite exec --tty` (installing the agent on the Sprite if needed) and checks the Sprite's auth file
  when it ends. Agents and jobs ask for it with `signal --needs --key signin:<agent>@<sprite> …`
  (`AGENTS.md`, `skills/sprites/SKILL.md`).
- **Kit:** `ui.morph` leaves the children of an element with `data-keep` alone (a live widget inside a
  re-rendered list).
- **If you changed this:** if this machine customized Settings' agent list, Home's needs list or the
  composer's agent picker, keep its changes but route sign-in through `signin.js`.

## 2026-10-11 · Settings: agent buttons work on the first click

- `views/settings/index.html` `renderAgents`: it runs on window focus, and the first click into the page
  focuses it; over a real network the list was rebuilt while the mouse was down, so the click was lost
  and buttons (Sign in, Make default) needed a second click. Now it rebuilds only when the list changed.
  Also: no "Make default" for agents that can't chat; the note says how sign-in works.

## 2026-10-11 · Coding agents: Cursor and Antigravity; guided sign-in in Settings

- **Two more agents** in `agents/agents.json`: **Cursor** (`cursor-agent`, installed with Cursor's script
  into `~/.local`, login `~/.config/cursor/auth.json`) and **Antigravity** (`agy`, Google's installer,
  login `~/.gemini/antigravity-cli/antigravity-oauth-token`). Both sign in with the owner's
  subscription and keep it in a file, so they work on a server (and on a Sprite: sign in once there).
  They run in the Terminal and headless (jobs, scripts: see `headlessArgv`); they have no `acp` yet, so
  they're not offered for chat. Antigravity shows the Gemini mark (`ui.agentMark` alias).
- **Guided sign-in** (Settings → Coding agents): for agents with a `signin` in `agents.json`
  (`{command, kind: approve | device | paste}`: Claude, Codex, Cursor, Antigravity), **Sign in** opens
  a dialog instead of a terminal: it installs the agent if needed, then shows **Open the sign-in page**
  and either the code to enter there (device), a box to paste the provider's code back (paste), or
  "Approve it there" (approve), and closes when the agent's auth file changes. "Show the terminal"
  opens what's running. Behind it, `views/desk/server.mjs` runs the login in a tmux session
  (`signin-<agent>`) and reads its screen: `POST|GET|DELETE /api/agents/:id/signin`,
  `POST /api/agents/:id/signin/code {code}`. OpenCode and Pi (menus) still sign in in the terminal.
- Settings shows agents without chat as "Ready for terminal and jobs"; the chat agent picker lists only
  agents with `acp`.
- **Why:** signing in meant finding a link inside a terminal and knowing where to paste a code back.
- **If you changed this:** if this machine edited `agents.json`, add the `cursor` and `antigravity`
  entries and the `signin` fields to its version rather than replacing it.

## 2026-10-11 · Mail: a new message no longer inherits an archived one's triage

- **What went wrong:** `msgs.id` was `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so when the newest
  message left the inbox (archived) and was dropped, the next new message got its id, and with it the
  old message's `triage` row (which `drop()` never deleted): the REI promo showed "needs_you: Render
  reports a timed out health check…", a Stripe receipt "Confirms the Apple Developer license
  agreement". The search index (`fts`, contentless) kept old entries the same way. This is very likely
  also the cause of the earlier "DMARC report" reasons on promos (many DMARC reports get archived).
- **Fix** (`templates/mail/sync.py`, `README.md`): `msgs` is `AUTOINCREMENT`. On its first run the new
  `sync.py` rebuilds `msgs` keeping every id (`never_reuse_ids`), sets the counter above any id triage or
  corrections ever used, deletes triage rows decided before their message arrived or whose message is
  gone (they're sorted again on the next triage run), clears those `mail:<id>` items from Home, and
  rebuilds the search index. From then on `drop()` deletes a message's search entry and triage row too,
  and takes its "Needs you" item off Home.
- **Migration:** copy `templates/mail/sync.py` over `views/mail/sync.py` (if this machine's copy has its
  own changes, port `MSGS`, `never_reuse_ids`, `clear_needs`, `drop` and `DROPPED_NEEDS`), back up
  `~/data/mail/mail.db` first, then `systemctl --user start mail-sync` and check its log says "ids are
  never reused now". No restart of `mail` needed.
- **If you changed this:** the important parts are AUTOINCREMENT (keeping ids) and `drop()` deleting the
  triage row; keep both whatever else this machine changed.

## 2026-10-12 · Chat: a new agent's models show before its first chat; Pi chats work again

- **What:** a new chat's Model (and Effort) menu shows what the agent offered in its last chat, so an
  agent nobody had chatted with (OpenCode, Pi) showed no models. Now agentd asks: when an agent has
  nothing remembered, `GET /agents/<id>/options` starts a short ACP session just to read its models and
  effort, remembers them, and stops it (one probe per agent at a time; a failure isn't retried for 10
  minutes). Separately, Pi moved npm packages: `@mariozechner/pi-coding-agent` stopped at 0.73.1, which
  doesn't know pi-acp's `get_available_thinking_levels` and answers without the request's id, so every
  Pi chat hung at "starting". Pi now installs from `@earendil-works/pi-coding-agent` (1.1.0: ~400 models
  over OpenRouter, five thinking levels as Effort).
- **How:** `agentd/threads.mjs` `probeOptions()`, `agentd/server.mjs` (the options route),
  `agents/agents.json` (Pi's `install`), a test in `agentd/test/chat.test.mjs`.
- **Migration:** restart agentd (`systemctl --user restart agentd`). If Pi is installed, run its new
  install line: `npm rm -g @mariozechner/pi-coding-agent; npm i -g @earendil-works/pi-coding-agent`,
  then check `pi --version` is 1.x and `pi -p "Reply with just: ok"` answers (settings and sign-in in
  `~/.pi` carry over).
- **If you changed this:** if this machine has its own options route, have it call
  `threads.probeOptions(agent)` when nothing is remembered.

## 2026-10-12 · Chat: the composer has two buttons at every width

- **What:** the narrow composer's single settings button is now the design everywhere, split in two:
  the first button (agent mark + model) opens Agent (new chats) and Model; a quiet sliders button
  next to it opens everything else: Effort, the agent's other settings (Fast mode…), Folder (new
  full-page chats), Access (it shows a shield when the chat is on Ask first). The wide row of
  separate pickers and the 560px `ResizeObserver` are gone.
- **How** (`views/desk/public/app/thread.js`, `thread.css`): `renderComposerFoot()` renders `.c-settings`
  (`data-pick="settings"`) and `.c-more` (`data-pick="more"`); `pickMenu(anchor, which)` builds either
  menu; the `set*` methods are unchanged. `effortName()` was removed (nothing shows effort on the row).
- **If you changed this:** if this machine kept its own pickers for the wide layout, move them into
  `pickMenu()`: agent/model in the first menu, any other setting in the second.

## 2026-10-11 · Chat: a narrow composer puts its settings behind one button

- **What:** in the side panel (and on a phone) the composer's row of pickers (agent, model, effort,
  settings, folder, access) wrapped onto two lines, and more once a chat was running (usage, Stop).
  Now a composer narrower than 560px shows one settings button (agent mark + model, a shield when the
  chat is on Ask first) that opens one menu: Agent (new chats), Model, Effort, the agent's other
  settings (Fast mode…), Folder (new full-page chats), Access. Usage, Stop and Send stay on the row.
  Wide composers are unchanged.
- **How** (`views/desk/public/app/thread.js`, `thread.css`): a `ResizeObserver` on the composer sets
  `compact`; `settings()` reads the current choices; `settingsMenu()` is a grouped `ui.combobox`; each
  change goes through one method (`setAgent`, `setModel`, `setEffort`, `setOption`, `setCwd`,
  `setAccess`) used by both layouts.
- **If you changed this:** if this machine changed the composer's pickers, keep its pickers for the
  wide layout and add any new setting to `settingsMenu()` too.

## 2026-10-11 · Chat: the slash-command note fits a phone

- `thread.js` `nudgeHtml`, `thread.css` `.nudge .acts`: the note's buttons are one group, so on a phone
  they move to the next line together instead of splitting. Nothing to carry over beyond the files.

## 2026-10-11 · Chat: recall, long chats, size limits, slash commands, tests

The rest of what Shep's ACP chat taught (`agentd/threads.mjs`, `agentd/store.mjs`, `agentd/server.mjs`,
`agentd/test/`, `views/desk/public/app/thread.js`, `thread.css`, `agentd/README.md`). Restart agentd and desk.

- **↑/↓ recall** what was sent in this chat, in an empty composer (or one still showing a recalled
  prompt), like a shell. Any edit ends recall.
- **Long chats** show their last 50 turns; "Show N earlier turns" adds 50 at a time, keeping the view in
  place. A message over 24k characters streams as plain text and is formatted when the turn ends.
- **Size limits on what's stored** (`clipContent`): tool output keeps its *last* 24k characters (a log's
  end says what happened; it kept the start). A diff over 24k characters or 2000 lines is kept as
  `{type: 'diff', path, truncated: true}`, shown as "Large change, not shown" with the file linked,
  instead of half a diff; at most 8 diffs per tool call. An image over 4 MB becomes a notice.
- **Images from other sites in chat** show as links, not loaded: an agent that read a hostile email could
  otherwise put text from it in an image address and the browser would send it (`chatMarkdown`).
  Images from Springroll itself (`/…`) still show. `ui.markdown` elsewhere is unchanged.
- **Slash commands the agent doesn't offer in chat** (it listed its commands and this isn't one, e.g.
  Claude's `/login`): not sent as a message; a note offers **Open terminal** (the agent's own CLI in the
  chat's folder, via `POST /api/sessions`) or **Send anyway**. Paths like `/home/…` aren't commands.
- **Switching to Full access** answers requests already waiting (allow once, as Full access does), and the
  chat carries on (`setAccess`).
- **The live turn** is the one working, not messages queued behind it (the shimmer and folding were off
  while a message was queued). Earlier turns shown later are inserted in order.
- **Schema:** the threads columns `options`, `access`, `effort` are added in `store.mjs` (were in
  `server.mjs`), so anything opening the store gets them.
- **Tests:** `node --test agentd/test/chat.test.mjs` runs the chat runtime against a fake ACP agent
  (`agentd/test/fake-agent.mjs`): streaming, Stop, Ask first → Full access, size limits.
- **If you changed this:** if this machine's `server.mjs` added more thread columns in that loop, move them
  to `store.mjs` with the others. If it changed how tool content is clipped, keep its limits but keep a
  big diff as `truncated` rather than cut text (the composer's diff view can't show half a diff).

## 2026-10-11 · Chat: a streamed answer stays one message

- **Fix** (`agentd/threads.mjs`, `onNotification`): the batching above ended the streamed message at
  any non-text update, and Claude sends usage and command updates mid-answer, so one answer was split
  into two items ("…because of g" / "as trapped…"). Now those updates only write pending text; only a
  new timeline item (`add`) ends the message. Restart agentd.
- **If you changed this:** nothing to carry over unless this machine changed `flushText`'s callers.

## 2026-10-11 · Chat: streaming in batches, Stop means stop, Escape stops in the panel

More from comparing with Shep's ACP chat (`agentd/threads.mjs`, `views/desk/public/app/thread.js`,
`app/api.js`, `app/main.js`, `ui/kit.js`, `agentd/README.md`). Restart agentd and desk.

- **Streaming in batches.** Every text chunk used to rewrite the whole message in SQLite, mask keys in
  all of it, and send all of it to every browser: work that grew with the square of an answer's
  length. Now streamed text is held in memory and written every 100ms (`appendText`/`flushText`), and
  browsers get only what was added: a new SSE event `append {threadId, id, from, text, updated}`. Any
  other update (tool call, plan, permission, turn end) writes pending text first, so order holds.
  `ThreadView.append` applies it, and reloads the chat if the offsets don't line up.
- **Paragraph guessing stays out of code.** Chunks with no message id still get a paragraph break
  between sentences ("done." + "Next…"), but not inside a code fence or inline code (`os.` + `Path`).
- **Stop means stop.** Messages queued behind a turn the owner stopped are no longer sent; they're
  kept and marked "Not sent" (`unsent`). A failed prompt after Stop counts as stopped, not an error.
  An agent that hasn't stopped 30s after Stop (`CANCEL_MS`) is closed with a notice; its session
  resumes on the next message. While stopping, the thread has `stopping: true` and the chat says
  "Stopping".
- **Escape stops** a working chat when focus is in it (its composer), in the side panel and focus mode
  too (before, Escape there closed the panel or left focus mode and the agent kept going). With focus
  elsewhere Escape closes things as before; it never stops a chat (or a job's run) just because it's
  on screen. (`Thread.stopOnEscape`, `ui.popoverOpen()`.)
- **Reconnects catch up.** After the event stream drops and reconnects, an open chat reloads
  (`agent:reconnect`); before, anything sent meanwhile was missing until you left and came back.
- **Links to Springroll open in place.** In `ui.markdown`, `#/…` and `/#/…` links (a chat, a file in
  Files) no longer open a new tab; from a View they open in the window around it. Other links still
  open a new tab.
- **If you changed this:** if this machine changed how `threads.mjs` handles text chunks, keep its
  change but route the text through `appendText` (and new items through `add`, which writes pending
  text first). A client that renders chats elsewhere must handle `append` or it'll miss text.

## 2026-10-11 · Mail triage: each reason comes from its own message; job notes hold patterns

- **What went wrong:** Mail triage logged a line in its `NOTES.md` after every run ("Comcast DMARC
  report … file as paper_trail", then Fastmail, Microsoft, …). With the notes full of DMARC lines,
  the triage agent copied "DMARC report" as the reason onto promos and a customer's question.
- **Mail triage prompt** (`jobs/mail-triage/job.json`): judge each message by its own from, subject
  and preview; never reuse a reason from `NOTES.md` or another message; a person asking a question
  from a personal address is never paper_trail. `NOTES.md` holds lasting patterns, one line each,
  merged, not a run log.
- **Every agent job** (`agentd/jobs.mjs`, `AGENTS.md` Jobs): `NOTES.md` is background, not answers to
  copy; keep lasting patterns, not a log of each run. Restart agentd.
- **If you changed this:** if this machine already added the same rule to its Mail triage prompt (and
  kept its own agent/model), keep its agent/model and take upstream's prompt wording instead of
  having both. Tidy `jobs/mail-triage/NOTES.md` into patterns if it reads like a run log. Look at
  triage reasons that repeat across unrelated mail (`~/data/mail/mail.db`, `triage`) and re-sort
  those messages if any are wrong.

## 2026-10-10 · Chat: settings follow the agent, Ask first works mid-chat, no stuck starts

Ideas carried over from Shep's ACP chat, and bugs found comparing the two (`agentd/threads.mjs`,
`agentd/acp.mjs`, `agentd/server.mjs`, `views/desk/public/app/thread.js`, `agentd/README.md`).

- **The chosen model sticks.** `connect()` used to save the agent's default model over the thread's,
  so the composer showed the default and, after the 15-minute idle stop, the chat (and a job's
  follow-ups, e.g. Mail triage on `haiku`) really ran on the default. Now the thread keeps what the
  agent reports it's using (`saveOptions`).
- **Settings follow the agent.** `config_option_update` and `set_config_option`'s reply now update the
  thread's options (`readOptions`), so a clamp (Fast mode unavailable, a model without effort) or the
  agent's own change (Claude after a plan is approved) shows truly. A refused change leaves a notice
  ("Couldn't change Fast mode: …"); values the agent doesn't list are ignored.
- **Remembered model per agent.** A model picked in the composer (`PATCH /threads/:id {model}`, or a new
  chat's draft) is saved as `agent_options.preferredModel`; new chats with that agent start on it.
  Resumed chats and jobs keep their own.
- **Ask first works right away.** Switching access mid-chat (`threads.setAccess`) moves the live
  session out of its full-access mode (Claude's `default`, Codex's `agent`), so the agent asks and
  the request shows. Before, it kept bypassing until it restarted. Modes given as a config option
  (category `mode`) count too.
- **Other settings** (Claude's Fast mode): `options.extra`, behind a settings button in the composer;
  `PATCH /threads/:id {option: {id, value}}`.
- **Notices.** agentd advertises `session.notices`, so Claude's warnings (rate limits, hooks) arrive as
  `notice` items instead of bold text glued into the answer (and the preview, phone notification and
  job report).
- **No stuck "starting".** An agent that hasn't started within a minute fails the turn with a clear
  error; Stop while it's starting stops it (the turn ends "Stopped") instead of cancelling a null
  session.
- **Smaller:** Pi's startup banner (`_meta.piAcp.startupInfo`) is dropped instead of being joined to
  its first reply (updates before `session/new` returns are held, then replayed); a warning when an
  agent can't resume earlier conversations at all; "The agent stopped unexpectedly", usage (context
  %) and slash commands reach open pages live; stopping an agent kills its whole systemd scope (or
  process group), not just the main process; Escape in the composer stops a running turn; agent
  images need an `image/*` type and links must be http(s).
- **If you changed this:** these are agentd internals. If this machine patched `connect()`,
  `setModel`/`setEffort` (now `changeSetting`) or `onNotification`, take upstream's and re-apply the
  idea of your patch on top; note it in `LOCAL.md`. Restart agentd afterwards
  (`systemctl --user restart agentd`); a turn in progress then is marked interrupted.

## 2026-10-10 · Job page shows the prompt as Markdown

- **The prompt renders** on a job's page (`views/desk/public/app/jobs.js` `renderDetail`) with
  `ui.markdown` in `.ui-prose`, like the agent's notes below it; it showed raw `**`, `1.` and
  backticks before. Command jobs still show `$ command` in mono.
- **Collapsed long prompts** (`app/pages.css` `.job-prompt`) cap at about six lines with a fade
  instead of `-webkit-line-clamp`, which can't clamp across paragraphs and lists.
- **If you changed this:** keep your layout; just render agent prompts with `ui.markdown` inside a
  `.ui-prose` element, and drop `white-space: pre-wrap` for them (keep it for commands).

## 2026-10-10 · Gmail: check the certificate; send over 587

- **Certificate checked** everywhere Springroll talks to Gmail's IMAP: `bin/gmail`, Mail's sync
  (`views/mail/sync.py`, from `templates/mail/sync.py`) and the Connections test
  (`views/desk/google.mjs`). Python's `IMAP4_SSL`/`SMTP_SSL` don't check it unless given a context,
  so passwords and tokens could be read by anyone in the middle; each now passes
  `ssl.create_default_context()`.
- **Sending uses port 587 with STARTTLS** (`bin/gmail` `smtp()`), not 465: Hetzner Cloud and some
  other hosts block outgoing 465, so sending failed there.
- **If you changed this:** if this machine patched these files for the same problems (and noted it
  in `LOCAL.md`), take upstream's version and remove those `LOCAL.md` lines. Mail's `sync.py` lives
  in `views/mail/`: apply the same one-line change there if it isn't replaced from the template.

## 2026-10-10 · Time zone; round run and pause buttons

- **Time zone** (Settings → Time zone; `desk.json` `timezone`): set from the owner's device the first
  time Springroll opens (`app/main.js`). Saving it sets the machine's clock (`sudo timedatectl
  set-timezone`) and agentd's (`process.env.TZ`, `POST /timezone` re-plans schedules), so "Daily at
  7:00 AM" means 7:00 where the owner is, not UTC; agents and commands run with it too. agentd reads
  it at start (`agentd/server.mjs` `applyTimezone`); `views/desk/server.mjs` saves it.
- **Round buttons** (`ui-round` in `ui/kit.css`: `.primary`, `.toggle[aria-pressed]`, `.stop`,
  `.filled`): the chat box's send and stop use them, and so do jobs: run (or stop / cancel a queued
  run) and a pause toggle, in rows and on the job page. Gallery shows them.
- **If you changed this:** if this machine's clock was set on purpose, set the same zone in Settings.

## 2026-10-10 · Jobs: groups, rows, problems first; a queue with time limits and retries

- **Runner** (`agentd/jobs.mjs`, `store.mjs`, `server.mjs`): every run goes through a queue kept in the
  `runs` table (new columns `attempt`, `not_before`, `how`; status `queued`), so waiting runs and retries
  survive restarts. At most 2 agent runs at once (`SPRINGROLL_MAX_AGENT_JOBS`); command jobs aren't
  counted. Per job (job.json, off unless set): `timeout` ("30m": stopped and counted as failed; command
  jobs run in their own process group so everything they started stops), `retries` (1-3) and
  `retryDelay` (default 5m); only the last attempt puts a failure on Home or notifies. `group` lists the
  job under a section. A run cut off by a restart is retried when the job has retries. An agent that
  can't start now records a failed run instead of a run stuck "running". `POST /jobs/<name>/cancel`
  (drops queued runs, stops a running one), `GET /jobs/queue`.
- **Jobs page** (`app/jobs.js`, `pages.css`): grouped sections (collapsible, with a failing count),
  one row per job in fixed columns (recent results, name and schedule or why it failed, next run or
  Running/Queued/Retry at, last run, Run/Stop and Pause), failing first; search and filter chips
  (Failing, Running, Paused) in the page bar. Runs: filter by job and All/Reports/Failed; three or more
  fine runs of one job on a day fold into one line. Editor: Group, Time limit, If it fails, Try again
  after. Detail: the same facts, attempts on runs. Fixed: editing a manual-only job showed "Daily".
- Seed jobs got groups (Springroll: update, backup; Inbox: mail triage, GitHub reviews).
- **If you changed this:** keep the queue in `jobs.mjs` (`enqueue`/`pump`/`settle`); jobs you added keep
  working without groups ("Other").

## 2026-10-10 · Chat: streamed bold text no longer breaks

- **What:** agentd glued chunks of one message with a blank line when one ended with "." and the next
  started with a capital or `*`, so a chunk starting with the closing `**` of bold text showed raw
  asterisks. Chunks with the same message id are now joined as they are; the guess applies only
  without ids, and never before `*` (`agentd/threads.mjs`). Messages already stored with
  `.\n\n** ` can be repaired by replacing it with `.** `.

## 2026-10-10 · Appearance: sidebar darker or lighter than the page (dark themes)

- **What:** Settings → Appearance → Sidebar: **Darker** (default, as before) or **Lighter**. Lighter
  swaps the two grounds in dark, non-glass themes: the page (and every app) takes the darker one
  (the theme's background 18% darker) and the sidebar the theme's own background. `desk.json`
  `sidebar: recessed|raised`; `ui/desk.js` sets `--bg` and `--sidebar-ground` and
  `data-sidebar="raised"`; `ui/theme.css` points `--surface-recessed` at it; `server.mjs` saves it.
- **If you changed this:** nothing to carry over unless your theme overrides `--surface-recessed`.

## 2026-10-10 · Needs you is an inbox any source can fill; Claude usage explained and fixable

- **Needs you / Worth knowing** (agentd `server.mjs` `normalizeSignal`/`postSignal`/`syncSignals`,
  `store.mjs` signals columns `icon`, `note`, `rev`; `bin/signal`; `app/home.js`):
  - Items carry `icon`, `note` (what an agent needs when the owner presses Chat), `rev`, and an
    `href` that may be a URL (opens in a new tab).
  - `signal sync <prefix>` / `POST /signals/sync`: a connector posts its whole open list; new items
    appear (one notification for all), missing ones come off, items the owner marked Done stay done
    until their `rev` changes. Cleared-at-source (dismissed = 2) is kept apart from owner-done (1).
  - Re-posting an unchanged item keeps its time and doesn't notify again (a 15-minute sync used to
    ping every time).
  - Home: generic rows use the item's icon, source and note; a source with more than four items
    shows three and "N more"; Worth knowing uses the same rows; rows without View keep the column.
  - `desk.signal()`, `desk.syncSignals()`, `desk.clearSignal()` for app pages.
  - Example connector: `jobs/github-reviews` (command job, every 15 minutes when `gh` is signed in):
    PRs waiting on the owner's review. AGENTS.md "Home" explains connecting any source.
- **Jobs:** `"keep": "failures"` (command jobs): a good run is counted, not kept as a chat. A failing
  job pings when it starts failing, not on every run.
- **Claude usage** (`views/desk/usage.mjs`): the long-lived `claude setup-token` token lacks the
  `user:profile` scope the usage endpoint needs (Anthropic answers with 429s that never clear). Usage
  now reads a full sign-in (`~/.claude/.credentials.json`, refreshed when it expires) and otherwise
  says so, with "Sign in to see usage" in the sidebar's Utilization popover: it opens a terminal
  running `claude auth login` (agents.json `fullLogin`; `POST /api/agents/<id>/login`). Chats keep
  using the long-lived token.
- **If you changed this:** keep the `signals` columns migration and the `signal` CLI as is; if your
  Home renders signals itself, use `icon`/`note`/`href` like `signalRow`.

## 2026-10-10 · Design cleanup: one page anatomy, tiles, the kit's own dropdowns and dialogs

- **What:** the owner found the app inconsistent (card sizes, one- vs two-line text, alignment,
  different ways to add things, browser dropdowns). Standards now in `DESIGN.md` (page anatomy,
  adding things, "same things look the same", selects and dialogs) and in the kit:
  - `ui/kit.css`: `ui-lede`, `ui-pagebar`, `ui-note`, `ui-tiles`/`ui-tile` (fixed structure: one-line
    title, two-line description that reserves its height, footer pinned to the bottom);
    `ui-page narrow` keeps the same left edge as other pages (only its content is narrower).
  - `ui/kit.js`: every `<select>` opens the kit's list (mouse and keyboard; phones keep the OS picker;
    `data-native` opts out); `ui.confirm()` / `ui.prompt()` replace the browser's dialogs;
    popovers opened inside a sheet float above it; comboboxes without search take the keyboard.
  - Pages: Apps, Jobs and Connections use tiles; tabs moved to a page bar (Jobs, Connections, Chats);
    one "New …" button in each heading opens a chat (New app, New job, New connection); the dashed
    "Build a new app" tile and Connections' "Something else?" card are gone; Connections shows
    Connected / Available instead of a section per category; job tiles show one sentence, not the
    raw prompt, and the job page clamps a long prompt; key rows keep their columns aligned
    (Delete behind ⋯); chat rows put their status dot by the time; every `confirm()`/`prompt()`
    is the kit dialog. Gallery shows the anatomy, tiles, selects and `ui.confirm`. Settings'
    theme cards are one height; the phone drawer no longer shadows the page edge.
- **If you changed this:** keep your pages but follow the anatomy and use `ui-tile` for grids;
  views you built that call `confirm()` should switch to `await ui.confirm(…)`.

## 2026-10-10 · Weather removed from Home and Settings

- **What:** the owner found weather out of place on Home. Gone: Home's weather block and ZIP form
  (`app/home.js`, `app/pages.css`), Settings' Home section (`views/settings/index.html`), the
  `weatherLocation` setting and `/api/weather` (`views/desk/server.mjs`), and the weather line in the
  Morning brief prompt (`jobs/morning-brief/job.json`). Weather, if wanted later, is an app.
- **If you changed this:** drop any weather you added to Home; leave a stray `weatherLocation` in
  `desk.json` alone (unused) or remove it.

## 2026-10-10 · "Ask" is "Chat"; Settings in the main nav

- **What:** item buttons on Home and Mail, the side panel's empty state ("Chat about this.") and the
  launcher's "Chat: …" say Chat, not Ask (`app/home.js`, `app/thread.js`, `app/main.js`, template
  `mail`; AGENTS.md and DESIGN.md wording). Settings moved from the gear beside the logo into the
  main nav under Connections (`NAV` in `app/main.js`, `index.html`). Failed-job chats now get their
  own suggestions ("Why did it fail?").
- **If you changed this:** rename your own Ask buttons to Chat; keep Settings wherever the owner put it.

## 2026-10-10 · Agent first: Ask on every item; agents reply to and archive email (`gmail`)

- **What:** Springroll's rule is now "the owner tells an agent, the agent does it" (`AGENTS.md`
  "Agent first", `DESIGN.md` Rules). Items on Home's Needs you and Mail's Today get **Ask** (opens the
  chat beside the page about that one item, with a note telling the agent what it is and how to act),
  **View** and **Done**; the ⋯ menus, Mail's draft drawer and Move menu are gone. Mail's reading pane
  has Ask too. Approvals and Add key keep their direct buttons.
- **`desk.askAbout({key, label, note, thread})`** (`ui/desk.js` → `app/main.js` `askAbout`): the panel
  remembers one chat per item (`desk.panel.item:<key>`); the empty chat offers item actions
  ("Reply for me", "Archive it", …) in `app/thread.js`.
- **`bin/gmail`** (new): `accounts`, `search` (Gmail syntax, all mail), `show`, `reply [--all]`,
  `send`, `archive`, `move`, for every account (app password or Google sign-in). Mail's
  `/api/msg/<uid>` now returns `msgid` so Mail ids work as refs. Replying or archiving marks the
  triage item done.
- **Send policy:** Connections → Gmail → "When an agent sends email": Send right away (default) or Ask
  me first (`google.json` `policy.send`; `POST /api/google/policy`); with "ask", `gmail` exits 3 until
  `--approved`. Never deletes mail. Mail triage still only sorts.
- **If you changed this:** keep your Home/Mail layouts but give each item an Ask that calls
  `askAbout` with a useful `note`; add `bin/gmail` and the AGENTS.md email exception as is.

## 2026-10-10 · "Needs you" as quiet task rows (Home, Mail, Connections); clearer Claude usage message

- **What:** a kit component, `.ui-task` in a `.ui-tasks` list (`ui/kit.css`): icon or avatar, title and
  time, one line of context (and an optional one-line code snippet), **one** primary action, a ⋯ menu
  for the rest, and a `.drawer` that opens inside the row for an input or a draft. Home's Needs you
  (`app/home.js`: Allow / Reply / Add key / Run again / Open / Set up; Deny, Open chat, Not needed,
  Tell the agent, Ask an agent behind ⋯), Mail's Today (template `mail`: Open, Draft, Done check;
  Open in Gmail, Copy draft, Move to… behind ⋯) and Connections' key requests use it; the yellow
  cards and their CSS are gone. Menus close when the page changes.
- **Usage:** Claude's 429 message says Anthropic is limiting usage checks for the account and that
  every app checking counts; the tooltip says when Springroll tries again.

## 2026-10-10 · Update skill: end right after scheduling the restart

- **What:** `skills/update/SKILL.md` step 5: after scheduling agentd's restart, publish the report
  and end; don't wait to verify it (the restart cut off a run that waited, which was then recorded
  as failed although the update had gone through).

## 2026-10-10 · Mail triage runs every 15 minutes; jobs can skip when there's nothing to do

- **What:** job.json takes `onlyIf`, a shell check agentd runs before each scheduled run
  (`Jobs.check`); a non-zero exit skips the run entirely (no agent, nothing in Runs). The job page
  says "…, when there's work". `jobs/mail-triage` is now `*/15 * * * *` with an `onlyIf` that asks
  Mail for unsorted mail, and no `trigger`; Mail's `sync.py` no longer starts it (`trigger_triage`
  removed). Run now, and Mail's Sort now / Turn on sorting, still start it any time.
- **If you changed this:** keep the owner's on/off choice for mail-triage.

## 2026-10-10 · Triggered jobs respect pause; Mail triage is opt-in from Mail

- **What:** `POST /jobs/<name>/run` with `{"trigger": true}` (a start by another program, like
  Mail's sync on new mail) is skipped while the job is paused or already running; Run now is
  unchanged. job.json can say `"trigger": "new mail arrives"`, shown as "When new mail arrives"
  instead of "Manual only". `jobs/mail-triage` ships **paused**; Mail's Today tab (`api/today`
  returns `off`) says what sorting reads and has **Turn on sorting** (enables the job and starts it).
  `agentd/server.mjs`, `agentd/jobs.mjs`, `jobs/mail-triage/job.json`, template `mail`
  (`sync.py` sends `trigger`, `server.py`, `index.html`).
- **If you changed this:** a machine that patched `views/mail/sync.py` to check the job's
  `enabled` itself (and made `api/today` say "off") can take upstream's version and drop that
  LOCAL.md line. Keep the owner's choice: if they turned triage on, leave it on.

## 2026-10-10 · Mail triage: an agent sorts new mail; Mail opens on Today

- **What:** a new job, `jobs/mail-triage` (Claude · Haiku · low thinking, no schedule, no phone
  pings), sorts new mail from every account into needs you / worth knowing / paper trail / feed /
  noise, each with a short reason (and an action and a reply draft when one is expected), using
  only sender, subject and preview unless it drafts. Its rules are `jobs/mail-triage/RULES.md`
  (plain English, the owner's to edit); when the owner moves a message in Mail, the next run turns
  it into a rule. Emails that need the owner go on Home (`signal --needs --quiet`, key `mail:<id>`);
  opening the email or marking it done takes the card off.
- **Mail** (template `mail`; this machine's `views/mail`): `server.py` adds the triage API
  (`GET api/triage/pending`, `POST api/triage`, `GET api/today`, `POST api/triage/<id>/done|correct`,
  `GET api/corrections`, `POST api/corrections/seen`; tables `triage`, `corrections`). `sync.py`
  starts the job when there's unsorted mail from the last 2 days (at most every 10 minutes). The
  page has two tabs, **Today** (the verdicts: needs-you cards with draft, Open, Reply in Gmail,
  Done, Move to…; worth knowing; filed counts) and **Inbox** (as before). Mail never changes Gmail.
- **`signal --quiet`:** a needs-you signal without the phone notification.
- **Migration:** restart the mail service (`systemctl --user restart mail`). The first triage run
  starts at the next sync. If the owner doesn't want an agent reading mail, disable the job.

## 2026-10-10 · Jobs choose their model and thinking

- **What:** job.json takes `model` and `effort` (thinking) next to `agent`; empty means the agent's
  default. The job editor offers the chosen agent's real lists (what it offered at its last session,
  `GET /agents/<id>/options`) and the job page shows them. A run starts its session with them
  (`Jobs.run` sets the thread's model and effort before the first prompt). Use a small model with
  low thinking for sorting and summarizing jobs.
- **Files:** `agentd/jobs.mjs`, `agentd/server.mjs`, `app/jobs.js`.

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
