# Design

How everything on this machine should look and feel. Read this before
building or changing a View. The live reference is the **Gallery** View
(`/v/gallery/`): copy markup from it.

The spirit: a calm, dense, tool-like interface (think Linear, bb, a good
code editor) with a quiet color discipline (Springroll). Content-first Views
(reading, music, recipes) may open up with a big display title and generous
space. Nothing should look like a generic web template.

## The pieces

- `views/desk/public/ui/theme.css`: tokens (colors, surfaces, type, shape,
  density). Every View links it and `/ui/desk.js`.
- `views/desk/public/ui/kit.css` + `kit.js`: the components (`ui-*` classes)
  and their behavior (`window.ui`).
- `views/desk/public/ui/custom.css`: the owner's overrides, loaded last.
- Appearance settings (theme, accent, fonts, density, corners, text size) are
  in `~/home/desk.json`, changed from Settings. Never hard-code what a setting
  controls.

## Rules

**Build from the kit.** Use `ui-` components and tokens; don't restyle them
per View. If you need something the kit lacks (a calendar grid, a player
bar), add it to `kit.css`/`kit.js` as a general component, show it in the
Gallery, and then use it. View CSS is for layout, not for new looks.

**Color is meaning.** Every color comes from a variable, never a hex value.
- `--accent`: things you act on (primary buttons, links, focus, selection).
  One primary button per area at most.
- `--run`: in progress (syncing, playing, running).
- `--ok`, `--warn`, `--danger`: outcomes, shown as a 7px dot (`ui-dot`)
  beside muted text, or danger text for an error message. No colored rows,
  borders, or bars for status.
- Only two states get a tinted pill (`ui-pill`): running and needs-you.
- Everything else is `--fg`, `--muted`, `--faint`, or a surface.

**Depth comes from surfaces, not shadows.** `--surface-recessed` for
sidebars, wells and inputs; `--surface-raised` for cards; `--surface-overlay`
plus `--shadow-lg` only for things floating above (menus, dialogs, toasts).
Hairlines (`--line`) separate; prefer whitespace over a border when either
works.

**Type does the hierarchy.** Sizes only from the scale: `--text-xs` 12,
`--text-sm` 13 (metadata, controls), `--text-base` 15 (body, list titles),
`--text-lg` 17 (prose), `--text-xl` 22 (page titles), `--text-display`
(content-first title, one per page). Weights 400/550/650; 800 only for
display. Numbers that line up use `ui-mono` / `ui-num`. Prose max 68ch.
Section labels are `ui-label` (small caps style).

**Spacing and size come from density tokens**: `--ctl-h` (control height),
`--row-py`/`--row-px`, `--gap`, `--pad`, `--gutter`. Corners from
`--radius`, `--radius-sm`, `--radius-lg`. Sizes in rem for text, tokens for
everything else.

**Icons** are Lucide only: `ui.icon('name')` or `<i data-icon="name">`.
16px default, `currentColor`, beside text not instead of it (except in
toolbars, with a `title`). Give your View an icon: a file `ICON` containing
a Lucide name.

**Layout patterns**
- Tool View: `body.ui-app` → `ui-toolbar` → `ui-split` (list | detail).
  Lists are `ui-list` of `ui-row`. Selected row is `.selected`.
- Settings-like View: `ui-page narrow`, `ui-section` with a `ui-label`,
  options in a `ui-card`.
- Content View: `ui-page`, `ui-display` title, `ui-prose` body.
- Every empty, loading and error state is designed: `ui-empty` with an icon,
  one line, and an action if there is one; `ui-skeleton` while loading.

**Motion** is quick and quiet (`--fast`, `--med`), only for state changes
(open, select, appear). Respect reduced motion (the tokens do).

**Phones**: every View works at 375px wide. Splits collapse to one pane
(toggle `.show-detail` on `.ui-split`); touch targets grow automatically.

## Before you say a View is done

1. Screenshot it with Playwright in a dark theme and a light one
   (`desk theme springroll-dark`, `desk theme tokyo-day`, then restore the
   owner's), at desktop and phone width, with real data, empty, and loading.
2. Check: no hex colors in View CSS, no new font sizes, one primary action,
   status as dots, an `ICON` file, and it still looks right at compact and
   spacious density.
3. If you added to the kit, check the Gallery too.
