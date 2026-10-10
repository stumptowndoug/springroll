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
- Only two states get a tinted pill (`ui-pill`): **running** and **needs you**.
- A trail of recent outcomes is `ui-trail`.
- Everything else is `--fg`, `--muted`, `--faint`, or a surface.

**Type does the hierarchy.** Scale only: `--text-2xs` 11 (eyebrows, section
labels), `--text-xs` 12, `--text-sm` 13 (metadata, controls), `--text-base` 15
(body, list titles), `--text-lg` 17 (row titles, prose), `--text-xl` 22
(thread and sheet titles), `--text-display` (one per page). Weights 400/550/650;
800 only for display. **Mono is telemetry**: times, durations, counts, costs,
schedules (`ui-mono`). Prose is `ui-prose` (max ~72ch); agent or user text is
rendered with `ui.markdown()` inside it.

**Every page has a heading**: `ui-heading` with an eyebrow (`ui-eyebrow`), a
display title **ending with a period** ("Jobs.", "Morning brief."), and
actions on the right (one primary). Detail pages start with a back link
(`ui-back`). Sections are `ui-section` with a `ui-label`.

**Controls are pills.** `ui-btn` (`.primary`, `.ghost`, `.sm`, `.icon`);
**quiet** actions (`ui-btn quiet`: accent text, no fill) for row and detail
actions; `ui-link-action` ("Clear filters →") for text actions; `ui-icon-btn`
(add `data-dot` when something is applied). Segmented choices: `ui-seg`.
Filters and tags: `ui-chip`. What something is about: `ui-context`.

**One popover shell for all floating UI** (`ui.popover`, `.ui-menu`,
`.ui-popover`). Pickers are `ui.combobox()` (searchable, keyboard-driven,
looks like text until opened: `ui-combo`). **Filters hide behind an icon
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
  `ui-feed-row` (time · dot · title · preview · chevron).
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
   action, status as dots, a page heading, an `ICON` file, and it still looks
   right at compact and spacious density.
3. If you added to the kit, check the Gallery too.
