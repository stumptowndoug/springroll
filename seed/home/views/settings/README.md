# Settings

Theme, text size, keyboard shortcuts and phone notifications for the Desk and
every View. A static page: it reads and writes `/api/settings` (stored in
`~/home/desk.json`), lists themes from `/ui/themes.json` and shortcuts from
`/ui/hotkeys.json`. Changes apply live on every open device.

To add a theme, append it to `views/desk/public/ui/themes.json` (seven colors:
bg, fg, accent, run, ok, warn, danger). To change a shortcut, edit
`views/desk/public/ui/hotkeys.json`.
