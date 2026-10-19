---
name: apps
description: How to build or change an app on this machine (a folder under ~/home/views/ that Springroll shows at /v/<name>/): folder layout, README, ICON, PORT, systemd service, JSON API, Chat/View/Done on items, the theme and component kit, window.desk, and how to check it. Use before building, changing or fixing any app or anything visual in Springroll.
---

# Apps (the `views/` folder)

The owner calls these **apps**; on disk each is a folder under `views/` (the name "View" is
internal: `views/`, `window.desk`, `/v/<name>/`). Say "app" to the owner.

An app is a folder `views/<name>/` that Springroll shows at `/v/<name>/` and lists on the Apps page
(`#/apps`, one item in the sidebar). A `.placeholder` file marks one not built yet; when you build
the real version, delete it.

- `README.md`: the first `# Heading` is the app's title, the first paragraph its one-line
  description. Then: what it does, how it's built, where its data lives, its JSON API. Write it for
  the next agent (maybe Codex, maybe you in a month) who has to change it.
- `ICON`: a Lucide icon name (lucide.dev/icons) for the sidebar and tiles.
- Either a static `index.html`, or a server: put its port in a file named `PORT` and listen on
  `127.0.0.1:<port>`. Pick a port from 8100 up that no other app uses (`cat views/*/PORT`).
- Springroll proxies `/v/<name>/...` to your server with the prefix removed, so **use relative
  URLs** (`api/items`, not `/api/items`).
- Long-running parts are systemd **user** services. Keep the unit file in the app folder as
  `<name>.service` and install it with
  `systemctl --user link ~/home/views/<name>/<name>.service && systemctl --user enable --now <name>`.
  Every service gets memory limits sized to what it needs and gives way before Springroll if memory
  runs out: `MemoryHigh=300M`, `MemoryMax=500M`, `OOMScoreAdjust=300` in `[Service]`.
- Buttons, playback, search and so on must work through ordinary code. An app keeps working when no
  agent is running. You build and fix it; you don't run every click.
- Every app's server exposes its data as a JSON API, documented in its README, so other apps and
  agents can use it.
- Every item the owner might act on gets **Chat** (`desk.askAbout({key, label, note})` opens the
  chat beside it about that item; `note` tells the agent what it is and how to act on it), **View**
  (the thing itself) and **Done**. Keep direct buttons only for what an agent can't do for them
  (approve, paste a secret).
- Optional: `STATUS` naming an endpoint (e.g. `api/status`) returning
  `{text, level: ok|warn|danger, icon, title}` puts a chip in the sidebar. Only for something worth
  a glance.
- Optional: `SETUP.md` for anything the owner must do first (accounts, keys). A `.setup-pending`
  file makes Springroll offer a setup chat that follows it.
- Default stack: a small app is one `index.html` with no build step. A bigger one can use Vite +
  React. Backends in whatever fits; Python or Node.
- Prefer mature open-source libraries over writing everything. It must work on a phone.
- Templates (starting points) live in the seed (`~/.config/springroll/seed` → `templates/`);
  `add-view <name>` installs one, `add-view --list` lists them.

## Look and feel

Read `DESIGN.md` before building or changing anything visual, and copy from the Gallery app
(`views/gallery/`). In every app's HTML, first thing:

    <link rel="stylesheet" href="/ui/theme.css">
    <script src="/ui/desk.js"></script>

(Absolute paths: Springroll serves them.) That gives the app the owner's theme and appearance
settings, live; the component kit (`ui-*` classes; `window.ui` for icons, popovers, comboboxes,
markdown, toasts); and the owner's `custom.css`. Use tokens and kit components, never hex colors or
one-off component styles. If the kit lacks something, add it to the kit
(`views/desk/public/ui/kit.css` / `kit.js`) and show it in the Gallery.

`window.desk`: `desk.ask(text)` starts a chat with you about this app (use it for "ask about this"
buttons), `desk.go('#/t/<id>' | '#/jobs' | '#/new?text=…')` navigates Springroll, `desk.open(name)`
opens another app, `desk.notify(text)`, `desk.onTheme(fn)` for anything drawn in code that needs the
theme's colors. `desk.context({label, note})` tells the chat panel what the owner is looking at
inside the app (an email, a file and lines): the panel shows `label`, and `note` reaches the agent
as part of `[Context from Springroll]`. `desk.discuss()` opens the panel. `desk.signal(…)` and
`desk.syncSignals(…)` put items on the Timeline (`skills/timeline/SKILL.md`).

To show the owner a file: `show ~/home/AGENTS.md:12-20`. Run from a chat, it opens beside that chat
(Markdown as a document, text as code with those lines marked, images, audio and video shown,
a PDF one click from a new tab; it follows edits); otherwise in
Files at those lines. In an app, link `/#/v/files#p=<url-encoded path>&l=12-20`.

Themes: `views/desk/public/ui/themes.json` (seven colors each; run `check-themes` after adding
one). Fonts: `ui/fonts.json`. Shortcuts: `ui/hotkeys.json`. The owner's choices: `~/home/desk.json`.

## Springroll itself

`views/desk/` is the Springroll app itself (`public/app/` is its UI, `server.mjs` its server) and
`views/settings/` its settings page. You can change both. Restart after server changes:
`systemctl --user restart desk` (or `agentd`). Log changes to Springroll itself in `LOCAL.md`.

## Before you say it's done

`curl` the app through Springroll (`curl -s localhost:8000/v/<name>/`), read the service logs
(`journalctl --user -u <name> -n 50`), and for anything visual load it in a headless browser
(Playwright) and look at screenshots in a dark and a light theme and at phone width. Then
`show <name>`.
