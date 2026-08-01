/*
 * A theme is one accent, a run color, and three status hues on a ground
 * pair, plus a light/dark flag. The accent carries everything you act on —
 * buttons, links, focus. The run color carries in-flight state (running
 * pill and pulsing dots). ok/warn/danger carry outcomes as dots, with a
 * failed run's error message in danger text. Everything else derives in
 * the design system.
 */
export interface ThemeColors {
  readonly bg: string;
  readonly fg: string;
  readonly accent: string;
  readonly run: string;
  readonly ok: string;
  readonly warn: string;
  readonly danger: string;
}

export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly appearance: "light" | "dark" | "system";
  readonly colors?: ThemeColors;
  readonly preview: ThemeColors;
}

/*
 * The ShrimpRoll pair keeps Obsidian's grounds and takes its working colors
 * from the spring-roll style guide: herb-green accent (spring-roll's
 * #357953 button fill rather than its #3F8F63 mark, which only reaches
 * 4.0:1 with white button text; dark brightens the fill a step so links
 * clear 3:1 on graphite), carrot for running, chili for failure, herb
 * green for success.
 */
const shrimprollLight = {
  bg: "#FFFFFF",
  fg: "#222222",
  accent: "#357953",
  run: "#D98232",
  ok: "#3F8F63",
  warn: "#E0AC00",
  danger: "#C65346",
} satisfies ThemeColors;

const shrimprollDark = {
  bg: "#1E1E1E",
  fg: "#DADADA",
  accent: "#35835A",
  run: "#E0934F",
  ok: "#5BAB80",
  warn: "#E0AC00",
  danger: "#E06A58",
} satisfies ThemeColors;

const dracula = {
  bg: "#282A36",
  fg: "#F8F8F2",
  accent: "#BD93F9",
  run: "#FFB86C",
  ok: "#50FA7B",
  warn: "#FFB86C",
  danger: "#FF5555",
} satisfies ThemeColors;

const catppuccinMocha = {
  bg: "#1E1E2E",
  fg: "#CDD6F4",
  accent: "#CBA6F7",
  run: "#FAB387",
  ok: "#A6E3A1",
  warn: "#FAB387",
  danger: "#F38BA8",
} satisfies ThemeColors;

const catppuccinLatte = {
  bg: "#EFF1F5",
  fg: "#4C4F69",
  accent: "#8839EF",
  run: "#FE640B",
  ok: "#40A02B",
  warn: "#DF8E1D",
  danger: "#D20F39",
} satisfies ThemeColors;

const gruvboxDark = {
  bg: "#282828",
  fg: "#EBDBB2",
  accent: "#FE8019",
  run: "#83A598",
  ok: "#B8BB26",
  warn: "#FABD2F",
  danger: "#FB4934",
} satisfies ThemeColors;

const nord = {
  bg: "#2E3440",
  fg: "#ECEFF4",
  accent: "#88C0D0",
  run: "#D08770",
  ok: "#A3BE8C",
  warn: "#EBCB8B",
  danger: "#BF616A",
} satisfies ThemeColors;

export const builtInThemes = [
  {
    id: "system",
    name: "System",
    description: "Follows this Mac’s appearance.",
    appearance: "system",
    preview: shrimprollLight,
  },
  {
    id: "shrimproll-light",
    name: "ShrimpRoll Light",
    description: "White ground with herb green and carrot.",
    appearance: "light",
    colors: shrimprollLight,
    preview: shrimprollLight,
  },
  {
    id: "shrimproll-dark",
    name: "ShrimpRoll Dark",
    description: "Graphite ground with herb green and carrot.",
    appearance: "dark",
    colors: shrimprollDark,
    preview: shrimprollDark,
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Cool charcoal with vivid candy hues.",
    appearance: "dark",
    colors: dracula,
    preview: dracula,
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    description: "Warm dark ground with pastel colors.",
    appearance: "dark",
    colors: catppuccinMocha,
    preview: catppuccinMocha,
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    description: "Cool paper ground with mauve accents.",
    appearance: "light",
    colors: catppuccinLatte,
    preview: catppuccinLatte,
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    description: "Earthy contrast with warm retro hues.",
    appearance: "dark",
    colors: gruvboxDark,
    preview: gruvboxDark,
  },
  {
    id: "nord",
    name: "Nord",
    description: "Low-contrast arctic blue and gray.",
    appearance: "dark",
    colors: nord,
    preview: nord,
  },
] as const satisfies readonly ThemeDefinition[];

export type ThemeId = (typeof builtInThemes)[number]["id"];

export interface ThemeRoot {
  readonly dataset: Record<string, string | undefined>;
  readonly style: {
    colorScheme: string;
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string;
  };
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const themeStorageKey = "shrimproll.theme";
const themeColorNames = ["bg", "fg", "accent", "ok", "warn", "danger"] as const;

export function isThemeId(value: string | null): value is ThemeId {
  return builtInThemes.some((theme) => theme.id === value);
}

export function readThemePreference(
  storage: ThemeStorage = window.localStorage,
): ThemeId {
  try {
    const stored = storage.getItem(themeStorageKey);
    return isThemeId(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(
  themeId: ThemeId,
  root: ThemeRoot = document.documentElement,
): void {
  const theme = builtInThemes.find((candidate) => candidate.id === themeId);
  if (!theme) return;

  root.dataset.theme = theme.id;
  root.dataset.appearance = theme.appearance;
  root.style.colorScheme =
    theme.appearance === "system" ? "light dark" : theme.appearance;

  for (const name of themeColorNames) {
    const value = "colors" in theme ? theme.colors[name] : undefined;
    if (value) {
      root.style.setProperty(`--${name}`, value);
    } else {
      root.style.removeProperty(`--${name}`);
    }
  }

  // Button text is the one derivation CSS cannot compute: whichever of
  // bg/fg contrasts better against the accent. Everything else derives in
  // the stylesheet from the six colors.
  if ("colors" in theme) {
    root.style.setProperty(
      "--button-fg",
      resolveThemeDerived(theme.colors, theme.appearance).buttonFg,
    );
  } else {
    root.style.removeProperty("--button-fg");
  }
}

export function saveThemePreference(
  themeId: ThemeId,
  storage: ThemeStorage = window.localStorage,
  root: ThemeRoot = document.documentElement,
): void {
  applyTheme(themeId, root);
  try {
    storage.setItem(themeStorageKey, themeId);
  } catch {
    // Applying the preference still works when storage is unavailable.
  }
}

export function loadThemePreference(
  storage: ThemeStorage = window.localStorage,
  root: ThemeRoot = document.documentElement,
): ThemeId {
  const themeId = readThemePreference(storage);
  applyTheme(themeId, root);
  return themeId;
}

/*
 * Contrast validation. Mirrors the CSS color-mix derivations so a theme —
 * hand-written or AI-generated — can be checked before it is offered.
 */

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseHex(value: string): Rgb {
  const hex = value.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex color: ${value}`);
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex(color: Rgb): string {
  const channel = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** Equivalent of CSS `color-mix(in srgb, a <ratio>%, b)`. */
export function mixColors(a: string, ratio: number, b: string): string {
  const from = parseHex(a);
  const into = parseHex(b);
  const mix = (x: number, y: number) => x * ratio + y * (1 - ratio);
  return toHex({
    r: mix(from.r, into.r),
    g: mix(from.g, into.g),
    b: mix(from.b, into.b),
  });
}

function relativeLuminance(value: string): number {
  const { r, g, b } = parseHex(value);
  const linear = (channel: number) => {
    const scaled = channel / 255;
    return scaled <= 0.04045
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const [darker, lighter] = first < second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ThemeDerived {
  readonly surface: string;
  readonly line: string;
  readonly muted: string;
  readonly attentionGround: string;
  readonly runningGround: string;
  readonly buttonFg: string;
  readonly link: string;
}

export function resolveThemeDerived(
  colors: ThemeColors,
  appearance: "light" | "dark",
): ThemeDerived {
  return {
    surface: mixColors(colors.fg, 0.04, colors.bg),
    line: mixColors(colors.fg, 0.12, colors.bg),
    muted: mixColors(colors.fg, 0.55, colors.bg),
    // Hue perception collapses at low luminance, so dark grounds need a
    // stronger mix to read as tinted at all.
    attentionGround: mixColors(
      colors.warn,
      appearance === "dark" ? 0.15 : 0.06,
      colors.bg,
    ),
    runningGround: mixColors(colors.run, 0.18, colors.bg),
    // Button text is pure white or black — whichever contrasts better —
    // so a deep accent can keep light text even on a dark ground, where
    // the theme's own fg would be too close to the accent.
    buttonFg:
      contrastRatio("#FFFFFF", colors.accent) >=
      contrastRatio("#000000", colors.accent)
        ? "#FFFFFF"
        : "#000000",
    link: colors.accent,
  };
}

export interface ThemeContrastIssue {
  readonly level: "error" | "warning";
  readonly pair: string;
  readonly ratio: number;
  readonly minimum: number;
}

export function validateThemeContrast(
  colors: ThemeColors,
  appearance: "light" | "dark",
): readonly ThemeContrastIssue[] {
  const derived = resolveThemeDerived(colors, appearance);
  const checks: readonly [
    level: "error" | "warning",
    pair: string,
    a: string,
    b: string,
    minimum: number,
  ][] = [
    ["error", "text on background", colors.fg, colors.bg, 4.5],
    ["error", "button text on accent", derived.buttonFg, colors.accent, 4.5],
    [
      "error",
      "text on attention ground",
      colors.fg,
      derived.attentionGround,
      4.5,
    ],
    ["error", "text on running ground", colors.fg, derived.runningGround, 4.5],
    ["error", "links on background", colors.accent, colors.bg, 3],
    ["warning", "muted text on background", derived.muted, colors.bg, 3],
  ];

  const issues: ThemeContrastIssue[] = [];
  for (const [level, pair, a, b, minimum] of checks) {
    const ratio = contrastRatio(a, b);
    if (ratio < minimum) {
      issues.push({ level, pair, ratio, minimum });
    }
  }
  return issues;
}

export const textSizes = [
  { id: "small", name: "Small" },
  { id: "medium", name: "Medium" },
  { id: "large", name: "Large" },
  { id: "xl", name: "Extra large" },
] as const;

export type TextSize = (typeof textSizes)[number]["id"];

const textSizeStorageKey = "shrimproll.textSize";

export function isTextSize(value: string | null): value is TextSize {
  return textSizes.some((size) => size.id === value);
}

export function readTextSizePreference(
  storage: ThemeStorage = window.localStorage,
): TextSize {
  try {
    const stored = storage.getItem(textSizeStorageKey);
    return isTextSize(stored) ? stored : "medium";
  } catch {
    return "medium";
  }
}

export function applyTextSize(
  size: TextSize,
  root: ThemeRoot = document.documentElement,
): void {
  root.dataset.fontSize = size;
}

export function saveTextSizePreference(
  size: TextSize,
  storage: ThemeStorage = window.localStorage,
  root: ThemeRoot = document.documentElement,
): void {
  applyTextSize(size, root);
  try {
    storage.setItem(textSizeStorageKey, size);
  } catch {
    // Applying the preference still works when storage is unavailable.
  }
}

export function loadTextSizePreference(
  storage: ThemeStorage = window.localStorage,
  root: ThemeRoot = document.documentElement,
): TextSize {
  const size = readTextSizePreference(storage);
  applyTextSize(size, root);
  return size;
}
