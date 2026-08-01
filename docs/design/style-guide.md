# Style guide

The visual language for the ShrimpRoll app. The interactive version of this
document, with a live theme switcher over every specimen, is
[`style-guide.html`](./style-guide.html) — open it directly in a browser.

The overall direction is minimal and Jitter-inspired (jitter.video): pure
grounds, one oversized display headline per page, pill shapes, hairline
separation, and color used sparingly.

## A theme is one accent plus status hues

A theme is a ground pair, one accent, three status hues, and a light/dark
appearance. The **accent** carries everything interactive and active:
buttons, links, focus, running, activity dots. The **status hues carry
outcomes**: `ok` as a dot; `warn` (needs review) and `danger` (failed) as
dots, with a failed run's error message set in the danger color. Every run
row shows a status dot — the feed reads as a ledger of outcomes:

```jsonc
// shrimproll-light
{
  "appearance": "light",
  "bg":     "#FFFFFF",
  "fg":     "#222222",
  "accent": "#2E7D52", // buttons, links, focus, running, activity
  "ok":     "#08B94E", // success dot
  "warn":   "#E0AC00", // review dot, needs-you chip ground
  "danger": "#E93147"  // fail dot, failure message text
}
```

Terminal palettes (Dracula, Catppuccin, Gruvbox, Nord) still exist as
built-ins, but as curated translations, not raw schemes — terminal
palettes are designed for colored text on dark grounds, and this app uses
color for grounds, buttons, and pills, which is a different job.

Every other color derives in app CSS with `color-mix`; components only ever
consume derived tokens, never theme colors directly (except dots):

| Derived          | Formula                                 | Used for                       |
| ---------------- | --------------------------------------- | ------------------------------ |
| surface          | `mix(fg 4%, bg)`                        | interactive containers, inputs |
| line             | `mix(fg 12%, bg)`                       | hairline separators            |
| muted            | `mix(fg 55%, bg)`                       | secondary text, telemetry      |
| attention-ground | `mix(warn 6%, bg)` light / `mix(warn 15%, bg)` dark (hue perception collapses at low luminance) | needs-you chip and pill |
| running-ground   | `mix(accent 18%, bg)`, pulsing accent dot | running pill |
| accent-tint      | `mix(accent 18%, bg)`                   | selection                      |
| danger-tint      | `mix(danger 15%, bg)`                   | error notice grounds           |
| button-bg / fg   | `accent` / whichever of `bg`/`fg` contrasts better (picked in TS) | primary pill |
| button2-bg / fg  | `surface` / `fg`                        | secondary pill                 |
| link             | `accent`                                | links and text actions         |
| ring             | `mix(accent 45%, bg)`                   | focus outline                  |

Every theme — hand-written or generated — must pass
`validateThemeContrast(colors, appearance)`: error-level checks are text on bg ≥ 4.5,
button text on accent ≥ 4.5, text on attention/running grounds ≥ 4.5, accent
on bg ≥ 3; muted on bg < 3 is a warning. This is the gate that will let
AI-generated themes ship unreviewed.

Attention lives in the feed, not above it: rows stay untinted and the dot
is the indicator — warn dot with an inline "Review →" for review, danger
dot with the error message in danger text for failures. A "needs you" chip
beside the page heading counts and jumps to them. There is no separate
banner — the feed is the single source of truth.

## Color usage rules

- Text is always `fg` or `muted`. Hues never color text, with one exception:
  links and text actions use `accent`.
- `accent` carries everything interactive and active. Status hues are
  dots, plus one sanctioned text use: a failed run's error message in
  `danger`.

## Type

- Display: 800 weight, `-0.03em` tracking, 0.95 line-height. One display
  headline per page ("What happened."), nothing else oversized.
- Body: Inter (or system sans), 14/1.6.
- Mono is telemetry only — times, costs, tokens, durations — and always
  `muted`. Telemetry whispers.
- Section labels: 10px, 700 weight, letterspaced uppercase, `muted`.

## Shape

- Radii: 100px pills, 14–16px surfaces, 10px small chips. Nothing else.
- Separation, in order of preference: hairline (`line`) by default; a
  `surface` ground only for interactive containers; a 2px `accent` ring only
  for focus and the single live element on screen. If a region is not
  interactive it gets a hairline, not a box.

## Button

The primary pill takes the theme's `accent` as its ground; its text is
whichever of `bg`/`fg` contrasts better, picked automatically when the theme
is applied. Disabled is 40% opacity. A `.secondary` pill uses the quiet
`button2` tokens (surface ground, `fg` text). Anything lighter than those is
a `link` text action ("Review →").

## Status

Most states are quiet — a 6px hue dot beside `muted` text:

- Sent / good → `ok` dot
- Nothing new / Paused → `line` dot
- Did not finish → `danger` dot

Only two states earn a tinted pill, because only two states want the eye:

- **Running** — `running-ground` (accent tint), accent dot, pulsing (static
  under `prefers-reduced-motion`)
- **Needs you** — warn dot + inline Review; failed — danger dot + danger-colored error text

List patterns, tables, and page layouts are intentionally out of scope of
this guide for now; they get specified against real screens when layout work
starts.
