# Style guide

The visual language for the ShrimpRoll app. The interactive version of this
document, with a live theme switcher over every specimen, is
[`style-guide.html`](./style-guide.html) — open it directly in a browser.

The overall direction is minimal and Jitter-inspired (jitter.video): pure
grounds, one oversized display headline per page, pill shapes, hairline
separation, and color used sparingly.

## A theme is one accent

A theme is a ground pair, one accent, three status hues, and a light/dark
appearance. The **accent** carries everything that wants the eye: buttons,
links, focus, the running state — and attention, which is marked by an
accent **border** on a near-neutral ground rather than by its own color.
**ok / warn / danger appear only as dot indicators** — never as grounds,
borders, or text:

```jsonc
// shrimproll-light
{
  "appearance": "light",
  "bg":     "#FFFFFF",
  "fg":     "#19171C",
  "accent": "#0891B2", // buttons, links, focus, running, attention border
  "ok":     "#2F9E55", // dot only
  "warn":   "#F5A623", // dot only
  "danger": "#E5484D"  // dot only
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
| attention-ground | `mix(accent 6%, bg)` + accent dot | needs-you pill and banner |
| running-ground   | `mix(accent 18%, bg)`                   | running pill                   |
| accent-tint      | `mix(accent 18%, bg)`                   | selection                      |
| danger-tint      | `mix(danger 15%, bg)`                   | error notice grounds           |
| button-bg / fg   | `accent` / whichever of `bg`/`fg` contrasts better (picked in TS) | primary pill |
| button2-bg / fg  | `surface` / `fg`                        | secondary pill                 |
| link             | `accent`                                | links and text actions         |
| ring             | `mix(accent 45%, bg)`                   | focus outline                  |

Every theme — hand-written or generated — must pass
`validateThemeContrast(colors)`: error-level checks are text on bg ≥ 4.5,
button text on accent ≥ 4.5, text on attention/running grounds ≥ 4.5, accent
on bg ≥ 3; muted on bg < 3 is a warning. This is the gate that will let
AI-generated themes ship unreviewed.

A note on why attention stays subtle: hue fills on dark grounds read as mud
(only pastels-toward-white work), and any strong mark competes with the
button. A barely-tinted accent ground plus a full-strength accent dot is
enough — the tint separates the surface, the dot points at it.

## Color usage rules

- Text is always `fg` or `muted`. Hues never color text, with one exception:
  links and text actions use `accent`.
- `ok`, `warn`, and `danger` appear only as status dots. `accent` carries
  everything interactive; attention surfaces are an accent tint with an
  accent dot.

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
- **Needs you** — `attention-ground` tint, accent dot

List patterns, tables, and page layouts are intentionally out of scope of
this guide for now; they get specified against real screens when layout work
starts.
