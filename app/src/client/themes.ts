export interface ThemeColors {
  readonly bg: string;
  readonly fg: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly accent: string;
}

export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly appearance: "light" | "dark" | "system";
  readonly colors?: ThemeColors;
  readonly preview: ThemeColors;
}

const shrimprollLight = {
  bg: "#FFFFFF",
  fg: "#19171C",
  red: "#E5484D",
  green: "#2F9E55",
  yellow: "#F5FF63",
  blue: "#55B1EA",
  magenta: "#A981FF",
  cyan: "#2AA8B0",
  accent: "#7A40ED",
} satisfies ThemeColors;

const shrimprollDark = {
  bg: "#19171C",
  fg: "#F4F1F7",
  red: "#FF6B70",
  green: "#69DB7C",
  yellow: "#F5FF63",
  blue: "#74C0FC",
  magenta: "#C3A6FF",
  cyan: "#66D9E8",
  accent: "#B48CFF",
} satisfies ThemeColors;

const dracula = {
  bg: "#282A36",
  fg: "#F8F8F2",
  red: "#FF5555",
  green: "#50FA7B",
  yellow: "#F1FA8C",
  blue: "#6272A4",
  magenta: "#FF79C6",
  cyan: "#8BE9FD",
  accent: "#BD93F9",
} satisfies ThemeColors;

const catppuccinMocha = {
  bg: "#1E1E2E",
  fg: "#CDD6F4",
  red: "#F38BA8",
  green: "#A6E3A1",
  yellow: "#F9E2AF",
  blue: "#89B4FA",
  magenta: "#CBA6F7",
  cyan: "#94E2D5",
  accent: "#CBA6F7",
} satisfies ThemeColors;

const gruvboxDark = {
  bg: "#282828",
  fg: "#EBDBB2",
  red: "#CC241D",
  green: "#98971A",
  yellow: "#D79921",
  blue: "#458588",
  magenta: "#B16286",
  cyan: "#689D6A",
  accent: "#83A598",
} satisfies ThemeColors;

const nord = {
  bg: "#2E3440",
  fg: "#ECEFF4",
  red: "#BF616A",
  green: "#A3BE8C",
  yellow: "#EBCB8B",
  blue: "#81A1C1",
  magenta: "#B48EAD",
  cyan: "#88C0D0",
  accent: "#88C0D0",
} satisfies ThemeColors;

const solarizedLight = {
  bg: "#FDF6E3",
  fg: "#657B83",
  red: "#DC322F",
  green: "#859900",
  yellow: "#B58900",
  blue: "#268BD2",
  magenta: "#D33682",
  cyan: "#2AA198",
  accent: "#268BD2",
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
    description: "Clean white ground with violet accents.",
    appearance: "light",
    colors: shrimprollLight,
    preview: shrimprollLight,
  },
  {
    id: "shrimproll-dark",
    name: "ShrimpRoll Dark",
    description: "Deep ink ground with soft violet accents.",
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
  {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Soft cream ground with balanced contrast.",
    appearance: "light",
    colors: solarizedLight,
    preview: solarizedLight,
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
const themeColorNames = [
  "bg",
  "fg",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "accent",
] as const;

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
