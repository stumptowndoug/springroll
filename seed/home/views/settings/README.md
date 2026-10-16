# Settings

Default chat agent (with its model and reasoning), utilization providers, theme, text size, keyboard shortcuts and phone notifications for Springroll and
every View. A static page: it reads and writes `/api/settings` (stored in
`~/home/desk.json`), lists themes from `/ui/themes.json` and shortcuts from
`/ui/hotkeys.json`. Changes apply live on every open device.

To add a theme, append it to `views/desk/public/ui/themes.json` (seven colors:
bg, fg, accent, run, ok, warn, danger). To change a shortcut, edit
`views/desk/public/ui/hotkeys.json`.

Coding agents: `defaultAgent`, and `chatDefaults: {<agent>: {model, effort}}`
for new chats (options from agentd's `GET /agents/<id>/options`). agentd
applies them in `POST /threads` to chats that don't pick their own; jobs don't
use them.

Utilization: four boolean switches in `desk.json`'s `utilization` object:
`claude`, `codex`, `antigravityGemini` (default on) and
`antigravityThirdParty` (default off: Antigravity's Claude/GPT quota pools).
`POST /api/settings {utilization: {codex: false}}` merges an individual choice.
Known boolean values only; other choices survive partial updates. The controls,
sidebar and usage API share `views/desk/public/app/usage-settings.mjs`.
Settings apply live across devices; providers only appear if installed and
signed in. Turning every switch off hides the sidebar's Utilization section.
