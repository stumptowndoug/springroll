/*
 * A theme is one accent, a run color, and three status hues on a ground
 * pair, plus a light/dark flag. The accent carries everything you act on —
 * buttons, links, focus. The run color carries in-flight state (running
 * pill and pulsing dots). ok/warn/danger carry outcomes as dots, with a
 * failed run's error message in danger text. An optional chart palette adds
 * categorical colors without changing those UI semantics. Everything else
 * derives in the design system.
 */
export interface ThemeColors {
  readonly bg: string;
  readonly fg: string;
  readonly accent: string;
  readonly run: string;
  readonly ok: string;
  readonly warn: string;
  readonly danger: string;
  /** Eight categorical colors; omitted themes retain their derived palette. */
  readonly chartSeries?: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
}

/** The consumer-owned colors Springroll passes to Rollmark's SVG renderer. */
export interface RollmarkChartColors {
  readonly series: string[];
  readonly text: string;
  readonly muted: string;
  readonly grid: string;
  readonly axis: string;
}

export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly appearance: "light" | "dark" | "system";
  /** Translucent surfaces over an ambient wash (window vibrancy someday). */
  readonly glass?: boolean;
  readonly colors?: ThemeColors;
  readonly preview: ThemeColors;
}

/*
 * The Springroll pair: quiet grounds, Obsidian-extended status hues, carrot
 * for in-flight, and the original spring-roll herb greens as the accent.
 * Light (#357953) carries white button text at 5.2; dark (#4DB07A) can't
 * (white 2.69), so its buttons take black text. The accent greens sit
 * deeper and duller than the bright ok dot (#08B94E), which is what keeps
 * "interactive" and "succeeded" apart within the same hue family.
 */
const springrollLight = {
  bg: "#FFFFFF",
  fg: "#222222",
  accent: "#357953",
  run: "#D98232",
  ok: "#08B94E",
  warn: "#E0AC00",
  danger: "#E93147",
  chartSeries: [
    "#357953",
    "#D98232",
    "#3978C6",
    "#8B5CB5",
    "#21858C",
    "#BE587C",
    "#E0AC00",
    "#E93147",
  ],
} satisfies ThemeColors;

const springrollDark = {
  bg: "#1E1E1E",
  fg: "#DADADA",
  accent: "#4db07a",
  run: "#E0934F",
  ok: "#08B94E",
  warn: "#E0AC00",
  danger: "#E93147",
  chartSeries: [
    "#4DB07A",
    "#E0934F",
    "#79ACEE",
    "#B99ADD",
    "#67C2C9",
    "#E58FAA",
    "#E0AC00",
    "#E93147",
  ],
} satisfies ThemeColors;

const catppuccinMocha = {
  bg: "#1E1E2E",
  fg: "#CDD6F4",
  accent: "#CBA6F7",
  run: "#FAB387",
  ok: "#A6E3A1",
  warn: "#F9E2AF",
  danger: "#F38BA8",
} satisfies ThemeColors;

const nightfox = {
  bg: "#192330",
  fg: "#CDCECF",
  accent: "#719CD6",
  run: "#F4A261",
  ok: "#81B29A",
  warn: "#DBC074",
  danger: "#C94F6D",
} satisfies ThemeColors;

const tokyoNight = {
  bg: "#1A1B26",
  fg: "#C0CAF5",
  accent: "#7AA2F7",
  run: "#FF9E64",
  ok: "#9ECE6A",
  warn: "#E0AF68",
  danger: "#F7768E",
} satisfies ThemeColors;

const dracula = {
  bg: "#282A36",
  fg: "#F8F8F2",
  accent: "#BD93F9",
  run: "#FFB86C",
  ok: "#50FA7B",
  warn: "#F1FA8C",
  danger: "#FF5555",
} satisfies ThemeColors;

const kanagawa = {
  bg: "#1F1F28",
  fg: "#DCD7BA",
  accent: "#7E9CD8",
  run: "#FFA066",
  ok: "#98BB6C",
  warn: "#E6C384",
  danger: "#FF5D62",
} satisfies ThemeColors;

const carbonfox = {
  bg: "#161616",
  fg: "#F2F4F8",
  accent: "#78A9FF",
  run: "#FF832B",
  ok: "#25BE6A",
  warn: "#FDDC69",
  danger: "#EE5396",
} satisfies ThemeColors;

const jellybeans = {
  bg: "#151515",
  fg: "#E8E8D3",
  accent: "#8197BF",
  run: "#FFB964",
  ok: "#99AD6A",
  warn: "#FAD07A",
  danger: "#CF6A4C",
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

const dayfox = {
  bg: "#F6F2EE",
  fg: "#3D2B5A",
  accent: "#2848A9",
  run: "#955F61",
  ok: "#396847",
  warn: "#AC5402",
  danger: "#A5222F",
} satisfies ThemeColors;

const tokyoDay = {
  bg: "#E1E2E7",
  fg: "#33549E",
  accent: "#2E7DE9",
  run: "#B15C00",
  ok: "#587539",
  warn: "#8C6C3E",
  danger: "#F52A65",
} satisfies ThemeColors;

const solarizedLight = {
  bg: "#FDF6E3",
  fg: "#4E6269",
  accent: "#268BD2",
  run: "#CB4B16",
  ok: "#859900",
  warn: "#B58900",
  danger: "#DC322F",
} satisfies ThemeColors;

const githubLight = {
  bg: "#FFFFFF",
  fg: "#24292F",
  accent: "#0969DA",
  run: "#BC4C00",
  ok: "#1A7F37",
  warn: "#9A6700",
  danger: "#CF222E",
} satisfies ThemeColors;

const catppuccinGlass = {
  bg: "#11111B",
  fg: "#CDD6F4",
  accent: "#CBA6F7",
  run: "#FAB387",
  ok: "#A6E3A1",
  warn: "#F9E2AF",
  danger: "#F38BA8",
} satisfies ThemeColors;

const nightfoxGlass = {
  bg: "#0F151E",
  fg: "#CDCECF",
  accent: "#719CD6",
  run: "#F4A261",
  ok: "#81B29A",
  warn: "#DBC074",
  danger: "#C94F6D",
} satisfies ThemeColors;

export const builtInThemes = [
  {
    id: "system",
    name: "System",
    description: "Follows this Mac\u2019s appearance.",
    appearance: "system",
    preview: springrollLight,
  },
  {
    id: "springroll-light",
    name: "Springroll Light",
    description: "White ground with herb green and carrot.",
    appearance: "light",
    colors: springrollLight,
    preview: springrollLight,
  },
  {
    id: "springroll-dark",
    name: "Springroll Dark",
    description: "Graphite ground with herb green and carrot.",
    appearance: "dark",
    colors: springrollDark,
    preview: springrollDark,
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    description: "Warm dark ground with pastel hues.",
    appearance: "dark",
    colors: catppuccinMocha,
    preview: catppuccinMocha,
  },
  {
    id: "nightfox",
    name: "Nightfox",
    description: "Deep navy ground with soft primaries.",
    appearance: "dark",
    colors: nightfox,
    preview: nightfox,
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Ink-blue ground with neon primaries.",
    appearance: "dark",
    colors: tokyoNight,
    preview: tokyoNight,
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
    id: "kanagawa",
    name: "Kanagawa",
    description: "Sumi-ink ground with woodblock hues.",
    appearance: "dark",
    colors: kanagawa,
    preview: kanagawa,
  },
  {
    id: "carbonfox",
    name: "Carbonfox",
    description: "Near-black carbon with IBM primaries.",
    appearance: "dark",
    colors: carbonfox,
    preview: carbonfox,
  },
  {
    id: "jellybeans",
    name: "Jellybeans",
    description: "Vintage charcoal with muted candy.",
    appearance: "dark",
    colors: jellybeans,
    preview: jellybeans,
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
    id: "dayfox",
    name: "Dayfox",
    description: "Warm cream ground with inkwell hues.",
    appearance: "light",
    colors: dayfox,
    preview: dayfox,
  },
  {
    id: "tokyo-day",
    name: "Tokyo Day",
    description: "Cool gray ground with blue-ink text.",
    appearance: "light",
    colors: tokyoDay,
    preview: tokyoDay,
  },
  {
    id: "solarized",
    name: "Solarized",
    description: "Sepia paper with the classic sixteen.",
    appearance: "light",
    colors: solarizedLight,
    preview: solarizedLight,
  },
  {
    id: "github-light",
    name: "GitHub Light",
    description: "Pure white with GitHub's primaries.",
    appearance: "light",
    colors: githubLight,
    preview: githubLight,
  },
  {
    id: "catppuccin-glass",
    name: "Catppuccin Glass",
    description: "Mocha hues on frosted glass.",
    appearance: "dark",
    glass: true,
    colors: catppuccinGlass,
    preview: catppuccinGlass,
  },
  {
    id: "nightfox-glass",
    name: "Nightfox Glass",
    description: "Nightfox hues on frosted glass.",
    appearance: "dark",
    glass: true,
    colors: nightfoxGlass,
    preview: nightfoxGlass,
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

const themeStorageKey = "springroll.theme";
// Pre-rename installs stored these; read-through so settings survive.
const legacyThemeStorageKey = "shrimproll.theme";
const legacyThemeIds: Record<string, string> = {
  "shrimproll-light": "springroll-light",
  "shrimproll-dark": "springroll-dark",
};
const themeColorNames = [
  "bg",
  "fg",
  "accent",
  "run",
  "ok",
  "warn",
  "danger",
] as const;

export function isThemeId(value: string | null): value is ThemeId {
  return builtInThemes.some((theme) => theme.id === value);
}

export function readThemePreference(
  storage: ThemeStorage = window.localStorage,
): ThemeId {
  try {
    const stored = storage.getItem(themeStorageKey);
    if (isThemeId(stored)) {
      return stored;
    }
    const legacy = storage.getItem(legacyThemeStorageKey);
    const mapped = legacy === null ? null : (legacyThemeIds[legacy] ?? legacy);
    if (isThemeId(mapped)) {
      storage.setItem(themeStorageKey, mapped);
      return mapped;
    }
    return "system";
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
  if ("glass" in theme && theme.glass) {
    root.dataset.glass = "true";
  } else {
    delete root.dataset.glass;
  }
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

/**
 * Pull a chart mark toward the theme foreground only as far as needed to
 * meet WCAG's 3:1 non-text contrast threshold against the report ground.
 */
function ensureChartContrast(
  color: string,
  foreground: string,
  background: string,
): string {
  if (contrastRatio(color, background) >= 3) return color;

  let passingColorRatio = 0;
  let failingColorRatio = 1;
  for (let index = 0; index < 12; index += 1) {
    const ratio = (passingColorRatio + failingColorRatio) / 2;
    const candidate = mixColors(color, ratio, foreground);
    if (contrastRatio(candidate, background) >= 3) {
      passingColorRatio = ratio;
    } else {
      failingColorRatio = ratio;
    }
  }
  return mixColors(color, passingColorRatio, foreground);
}

/**
 * Translate Springroll's compact semantic theme into Rollmark's eight-series
 * palette. Models still express no presentation: this is entirely a consumer
 * concern, using an explicit palette when supplied or deriving it from the
 * selected theme's semantic colors. Both paths use the same contrast guard.
 */
export function resolveRollmarkChartColors(
  colors: ThemeColors,
): RollmarkChartColors {
  const series = (
    colors.chartSeries ?? [
      colors.accent,
      colors.run,
      colors.ok,
      colors.warn,
      colors.danger,
      mixColors(colors.accent, 0.62, colors.fg),
      mixColors(colors.run, 0.62, colors.fg),
      mixColors(colors.ok, 0.62, colors.fg),
    ]
  ).map((color) => ensureChartContrast(color, colors.fg, colors.bg));

  return {
    series,
    text: colors.fg,
    muted: mixColors(colors.fg, 0.55, colors.bg),
    grid: mixColors(colors.fg, 0.1, colors.bg),
    axis: mixColors(colors.fg, 0.24, colors.bg),
  };
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

const textSizeStorageKey = "springroll.textSize";
const legacyTextSizeStorageKey = "shrimproll.textSize";

export function isTextSize(value: string | null): value is TextSize {
  return textSizes.some((size) => size.id === value);
}

export function readTextSizePreference(
  storage: ThemeStorage = window.localStorage,
): TextSize {
  try {
    const stored = storage.getItem(textSizeStorageKey);
    if (isTextSize(stored)) {
      return stored;
    }
    const legacy = storage.getItem(legacyTextSizeStorageKey);
    if (isTextSize(legacy)) {
      storage.setItem(textSizeStorageKey, legacy);
      return legacy;
    }
    return "medium";
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
