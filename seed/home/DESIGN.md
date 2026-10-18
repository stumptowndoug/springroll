# Design

How everything on this machine should look and feel. Read this before
building or changing a View. The live reference is the **Gallery** View
(`/v/gallery/`): copy markup from it.

The spirit, from Springroll: **quiet**. Color means something or it isn't
there. Type does the hierarchy. Chrome appears while you use it. From bb:
**dense and calm** like a good tool: one-line rows, finished things fade,
live things shimmer. Content-first Views (reading, music, a report) open up
with a display title and generous space. Nothing should look like a generic
web template.

## The pieces

- `views/desk/public/ui/theme.css`: tokens (colors, surfaces, type, shape,
  density). Every View links it and `/ui/desk.js`.
- `views/desk/public/ui/kit.css` + `kit.js`: the components (`ui-*` classes)
  and their behavior (`window.ui`: `icon`, `popover`, `combobox`, `markdown`,
  `toast`, `ago`, `duration`, …).
- `views/desk/public/ui/custom.css`: the owner's overrides, loaded last.
- Appearance settings (theme, accent, fonts, density, corners, text size) live
  in `~/home/desk.json`, changed from Settings. Never hard-code what a setting
  controls.

## Rules

**Agent first.** The owner tells an agent what they want; screens point at
things and open a conversation about them. Anything the owner might act on (an
email, a failed run, a question) is a row with **Chat** (opens the chat beside it
about that item: `desk.askAbout`), **View** (the thing itself) and **Done**. Keep
direct buttons only for what an agent can't do for them (approve, paste a key).
No row of five action buttons: the agent is the action.

**Build from the kit.** Use `ui-` components and tokens; don't restyle them
per View. If you need something the kit lacks (a calendar grid, a player bar),
add it to `kit.css`/`kit.js` as a general component, show it in the Gallery,
then use it. View CSS is for layout, not new looks.

**No resting borders.** Depth comes from surface fills: `--surface` for cards,
groups and inputs; `--surface-recessed` for sidebars and docks;
`--surface-overlay` + `--shadow-lg` only for things floating above (popovers,
dialogs, toasts, the composer). Hairlines (`--line`) only separate rows inside
a group (`ui-group`, `ui-list.lined`). Prefer whitespace over a line. Only
clickable cards react to hover.

**Color is meaning.** Every color comes from a variable, never a hex value.
- `--accent`: things you act on (primary buttons, links, focus, selection).
  One primary button per area at most.
- `--run`: in progress. `--ok`, `--warn`, `--danger`: outcomes, as a 7px dot
  (`ui-dot`) beside muted text (`ui-status`), or danger text for an error line.
  No colored rows, borders or bars for status.
- **Running** is a status like the rest: a pulsing `--run` dot, the word, and how long it's been going in
  mono (`ui.running(startedAt)`: "Running 12m"). No pill.
- Only **needs you** gets a tinted pill (`ui-pill attention`): the one colored shape on a page asks for
  the owner. Paused, queued and the rest are a dot and a word.
- A trail of recent outcomes is `ui-trail`.
- Everything else is `--fg`, `--muted`, `--faint`, or a surface.

**Type does the hierarchy.** Scale only: `--text-2xs` 11 (eyebrows, section
labels), `--text-xs` 12, `--text-sm` 13 (metadata, controls), `--text-base` 15
(body, list titles), `--text-lg` 17 (row titles, prose), `--text-xl` 22
(thread and sheet titles), `--text-display` (one per page). Weights 400/550/650;
800 only for display. **Mono is telemetry**: times, durations, counts, costs,
schedules (`ui-mono`). Prose is `ui-prose` (max ~72ch); agent or user text is
rendered with `ui.markdown()` inside it.

**Every page has the same anatomy**, in this order:
1. `ui-heading`: an eyebrow (`ui-eyebrow`), a display title **ending with a
   period** ("Jobs.", "Morning brief."), and actions on the right (one primary).
   Detail pages start with a back link (`ui-back`).
2. `ui-lede` (optional): one or two sentences about the page. Not per tab.
3. `ui-pagebar` (optional): tabs (`ui-seg`) and search, left-aligned. Tabs never
   sit in the heading's actions.
4. The content: `ui-section`s, each with a `ui-label` header. A short
   explanation goes under its group as `ui-note`, not above it.

Every page uses `ui-page` (or `ui-page narrow` for reading and detail pages: same
left edge, narrower content), so headings line up from page to page.

**Adding things**: a page that holds a collection (apps, jobs, chats,
connections, keys) adds to it with **one primary button in the heading**,
labeled "New …" ("New app", "New job", "New connection"; "Add a key" for data
the owner types). When an agent makes the thing, the button opens a chat with a
starting sentence (`#/new?text=Create a job that `): agent first. An empty
collection shows `ui-empty` with the same button. No dashed "add" tiles, no
"Something else?" cards.

**Same things look the same.** A grid of things is `ui-tiles` of `ui-tile`
(a top row with the icon beside a one-line title and an optional trail for a status or one small button, a description that is always two lines tall,
an optional detail line, a footer pinned to the bottom). A list is a `ui-group`
of `ui-row`s whose meta and actions sit in the same columns on every row (give
the row a grid when its parts vary). Titles are one line and truncate;
descriptions clamp to two lines and reserve that height, so cards and rows
never change size with their text. Rare or destructive row actions (Delete)
go behind a ⋯ menu; the one or two common ones stay visible.

**Controls are pills.** `ui-btn` (`.primary`, `.ghost`, `.sm`, `.icon`);
**quiet** actions (`ui-btn quiet`: accent text, no fill) for row and detail
actions; `ui-link-action` ("Clear filters →") for text actions; `ui-icon-btn`
(add `data-dot` when something is applied). **Round buttons** (`ui-round`: `.primary`,
`.toggle` with `aria-pressed`, `.stop`) for run, pause, send and stop, the same
everywhere. Segmented choices: `ui-seg`, for switching views (tabs); a setting with fixed
choices (size, density) is a `<select>`, like Settings → Appearance.
Filters: `ui-chip`. Where something came from (a job, Mail, GitHub): `ui-tag`, quiet, never colored. What something is about: `ui-context`.

**One popover shell for all floating UI** (`ui.popover`, `.ui-menu`,
`.ui-popover`). Pickers are `ui.combobox()` (searchable, keyboard-driven,
looks like text until opened: `ui-combo`). A plain `<select>` is fine in
forms: the kit opens its own list for it (same popover, keyboard, search when
long) and keeps the select's value and change events; phones keep the OS
picker. Never the browser's `confirm()`, `alert()` or `prompt()`: use
`await ui.confirm(title, {body, ok, danger})` and `await ui.prompt(title, value)`. **Filters hide behind an icon
button** that opens a popover of chips; never a permanent filter bar. Dialogs
(`ui-dialog`) for confirmations; sheets (`ui-sheet`) for editors.

**Spacing and size come from density tokens**: `--ctl-h`, `--row-py`,
`--row-px`, `--gap`, `--pad`, `--gutter`. Corners from `--radius`,
`--radius-sm`, `--radius-lg`, `--radius-control`. Text in rem.

**Icons** are Lucide only: `ui.icon('name')` or `<i data-icon="name">`, 14–16px,
`currentColor`, muted until hovered, beside text rather than instead of it
(icon-only only in toolbars, with a `title`). Every View has an `ICON` file.
Never put an icon on a tile, chip, circle or tinted square: just the icon.
Coding agents show their own mark: `ui.agentMark(id, name)` (`ui/logos.svg`).

**Patterns**
- Tool View: `body.ui-app` → `ui-toolbar` → `ui-split` (list | detail);
  lists are `ui-list` of `ui-row` (title, sub, mono meta); selected row
  `.selected`, unread `.unread`.
- Feed of things that happened: `ui-feed` with `ui-feed-day` headings and
  `ui-feed-row` (time · dot · title · preview · chevron); a `ui-tag` before the
  chevron says where it came from, and a `.lead` icon can stand in for the dot.
- Work in stages (to-dos, a pipeline): a kanban `ui-board` of `ui-board-col`s holding
  `ui-board-card`s; `ui.board(el, {onMove})` drags cards between columns. Touch has no drag,
  so a card opens a sheet that can move it.
- Facts about a thing: `ui-facts` (label/value with hairlines).
- Content View: `ui-page`, eyebrow, display title, `ui-prose lg`.
- Settings-like: `ui-page`, sections of `ui-card` options.
- Live work: `ui-shimmer` on a present-tense label ("Syncing mail"); a
  `ui-loading` line while a page loads; `ui-skeleton` for placeholders.
- Every empty, loading and error state is designed: `ui-empty` with an
  `orbit`, one line, and an action if there is one ("Every run lands here.").
- Command output: `ui-terminal`; file changes: `ui-diff`.
- Code: `await ui.codeBlock(text, {file})` (highlighted in the theme's colors,
  line numbers); a small editor: `await ui.editor(el, {value, file, onUpdate})`;
  a whole document (README, notes): `await ui.document(markdown)` inside
  `ui-prose`. Chat-sized text stays `ui.markdown()`; call `ui.highlight(el)`
  after it to color code blocks. Never load another highlighter or editor.

**Copy** is short and outcome-first. Join telemetry with " · ". Say what the
owner gets, not what the system does.

**Motion** is quick and quiet (`--fast`, `--med`), only for state changes.
Reduced motion is respected by the tokens.

**Phones**: every View works at 375px wide. Splits collapse to one pane
(toggle `.show-detail` on `.ui-split`); touch targets grow automatically;
hover-only affordances must have a visible alternative on touch.

## Before you say a View is done

1. Screenshot it with Playwright in a dark theme and a light one
   (`desk theme springroll-dark`, `desk theme springroll-light`, then restore the
   owner's from `desk settings`), at desktop and phone width, with real data,
   empty, and loading.
2. Check: no hex colors or borders in View CSS, no new font sizes, one primary
   action, status as dots, the page anatomy (heading, lede, pagebar), cards and
   rows that keep their size whatever the text, no browser dialogs, an `ICON`
   file, and it still looks right at compact and spacious density.
3. If you added to the kit, check the Gallery too.
