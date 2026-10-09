# Springroll changelog

What changed upstream, written for the agent that merges it into a machine
(see `skills/update/SKILL.md`). Newest first. Each entry: what and why, the
files, and **If you changed this**: how to carry the idea over when this
machine has its own version of those files.

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
