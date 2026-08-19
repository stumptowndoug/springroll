# Springroll style guide

Jitter (jitter.video) is the base inspiration; simplicity above all else.
Every rule below exists to keep the app quiet: color means something or it
isn't there, type does the hierarchy work, and chrome only appears while
you're using it.

## The token contract

A theme is exactly seven colors plus a light/dark flag. Everything else is
derived. This is the whole palette surface — themes (built-in or generated)
supply these and nothing more:

| Token    | Carries                                                     |
| -------- | ----------------------------------------------------------- |
| `bg`     | The page ground                                              |
| `fg`     | Text                                                         |
| `accent` | Everything you can act on: buttons, links, focus, selection  |
| `run`    | In-flight state: running pill, pulsing dots                  |
| `ok`     | Good outcome — dots only                                     |
| `warn`   | Needs-you outcome — dots only                                |
| `danger` | Failure — dots, plus a failed run's error text               |

Derived in CSS (`design-system.css`) via color-mix:

- `surface` = fg 4% over bg (cards, panels)
- `line` = fg 12% over bg (hairlines)
- `muted` = fg 55% over bg (secondary text)
- `running-ground` = run 18% over bg; `attention-ground` = warn 6% (light) /
  15% (dark) over bg
- `button-fg` = pure `#FFFFFF` or `#000000`, whichever contrasts more with
  the accent — never theme fg/bg

Perceptual rules learned the hard way: tinting toward white reads pastel,
toward black reads mud — always mix status grounds toward `bg`. Hue
perception collapses at low luminance, so dark grounds need 2–3× the
pigment of light ones.

Contrast gates (test-enforced for every built-in): fg/bg ≥ 4.5, button text
on accent ≥ 4.5, fg on both tinted grounds ≥ 4.5, accent on bg ≥ 3, muted
≥ 3 (warning).

## The standard pair

Grounds are quiet (white / `#222` and `#1E1E1E` / `#DADADA`). Status hues
are the Obsidian extended palette; carrot orange carries in-flight. **The
accent must sit away from every status hue** — the app is full of green
ok-dots, so a green accent makes "interactive" and "succeeded" the same
color. Accent hue lives in the blue–violet arc (or monochrome ink); green,
orange, yellow, and red are reserved for outcomes.

## Color usage rules

- Color is meaning. If an element isn't interactive (accent), in-flight
  (run), or an outcome (ok/warn/danger), it is fg, muted, or a ground.
- Status is dots-only: a 6px dot beside muted text. No borders, bars, or
  filled rows for state.
- Only two states earn a tinted pill, because only two states want the eye:
  **Running** (running-ground, run dot, pulsing — static under
  `prefers-reduced-motion`) and **Needs you** (attention-ground, warn dot).
- A failed run keeps its normal title; the error message beneath it is
  danger-colored text.
- Never introduce a hue outside the seven tokens.

## Type

16px root, rem-based ramp; the text-size setting scales the root
(87.5 / 100 / 112.5 / 125%).

- Display titles: `clamp(2.75rem, 7vw, 4.75rem)`, weight 800, tight
  tracking, `text-wrap: balance`. Every page gets one ("Inbox.",
  "Recipes.", the recipe name, the run letter's task name).
- Letter/prose body: 1.125rem (18px), max measure 68ch; tables and code
  break out to the full column.
- Section labels & eyebrows: 0.6875rem, weight 700, 0.12em tracking,
  uppercase, muted.
- Mono (`--font-mono`) is telemetry: times, next-run lines, model facts,
  stats. If a number lines up with other numbers, it's mono.

## Page frame

One frame for every page: `--page-width` 1120px, `--page-top` 56px,
`--page-bottom` 112px. Prose constrains itself *inside* the frame (68ch
measure); data (grids, feeds, tables) spans it. No page uses a narrower
frame except focused composers.

Header: 76px borderless titlebar, sprig logo left (accent-tinted,
currentColor), pill-active nav center. Detail pages open with a back link,
then an eyebrow/status, then the display title.

## Shape

- Cards and surfaces: `--radius-surface`, surface ground, no border.
- Popovers: 12px radius, `bg` ground (not surface), 1px line border, soft
  double shadow.
- Chips and pills: `--radius-pill`.
- Rows in a group share equal heights and hairline separators; lines never
  bend around content.

## Buttons

- **Primary** (`.button.primary`): accent fill, `button-fg` text, pill,
  40px min-height, `white-space: nowrap`. One per page at most — the page's
  single job (New recipe).
- **Quiet** (`.quiet-button`): accent text, no ground; icon at 12px. This
  is the standard row/detail action (▷ Run now, Pause, Enable ▾).
- **Icon** (`.icon-button`): 40px pill, surface ground, muted glyph that
  warms to fg on hover; used for the filter sliders. An accent dot pinned
  top-right signals applied state.
- **Text action** (`.text-action`): accent link-style ("Clear filters",
  "Delete this recipe →"). Destructive text actions stay accent until
  confirmed — danger is for outcomes, not invitations.

## Icons

Lucide/Feather dialect: 24 grid, 2px stroke, round caps and joins,
`currentColor`, inlined as components in `icons.tsx`. No icon libraries; no
per-recipe logos or decorative icons — the seed set stays small (play,
pause, plus, chevron, sliders, clock, message-circle).

## Popover grammar

One popover shell, three instances — the Enable menu, the filter panel, and
the model combobox. Fixed full-screen transparent backdrop dismisses; the
panel floats 10px off its trigger; Esc closes. New floating UI must reuse
this shell.

The **filter panel** (both Inbox and Recipes) orders its sections: Search,
Status, Tags, View (Recipes only). Chips are pill-outline, accent
border+text when on. Roadmap options appear disabled with a `soon` chip —
the panel teaches the roadmap the same way the Anywhere enable option does.

The **model combobox** replaces native selects wherever a model is chosen:
quiet trigger (value + chevron, 32ch ellipsis), search pinned on top, one
grouped scrolling list, pinned escape row first ("App default …" /
"Automatic"), right-aligned mono facts (`$in / $out · ctx`), full keyboard
(type, ↑↓, Enter, Esc).

## Feed and card grammar

- **Inbox rows**: clock/chat icon · time (mono) · status dot · recipe/context
  label · short, muted one-line response (or danger error text) · chevron.
  Run dots carry outcome color; chat dots stay the neutral line color.
  Day-grouped under uppercase headings. All · Runs · Chats switches the feed
  source. Quiet "nothing new" runs aggregate.
- **Recipe cards** (E1): title + run-trail dots (last 7 outcomes) up top,
  2-line clamped ask, hairline, then quiet actions bottom-left and mono
  next-run telemetry bottom-right. History up top, actions at hand, future
  at the exit.
- **Recipe detail** reads like a card scaled up: status eyebrow → display
  title → prompt (68ch) → quiet ▷ Run now → facts grid (Schedule | Next
  run, Connection | Tag, Model) → Where it runs → delete text-action.
- Tags are single-valued, set on the recipe detail page, used for
  filtering/grouping — never rendered as badges on cards.

## Where it runs

Enablement is a placement choice, not a toggle: Paused / On this Mac /
Anywhere (disabled, "Requires Cloud · soon"). Secrets never sync
implicitly; Anywhere will require an explicit consent sheet when Cloud
ships.
