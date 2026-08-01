import { describe, expect, test } from "bun:test";
import {
  applyTextSize,
  applyTheme,
  builtInThemes,
  contrastRatio,
  isTextSize,
  isThemeId,
  mixColors,
  readTextSizePreference,
  readThemePreference,
  resolveThemeDerived,
  saveTextSizePreference,
  saveThemePreference,
  type ThemeRoot,
  type ThemeStorage,
  textSizes,
  validateThemeContrast,
} from "../src/client/themes.ts";

function createThemeRoot() {
  const properties = new Map<string, string>();
  const root: ThemeRoot = {
    dataset: {},
    style: {
      colorScheme: "",
      setProperty(name, value) {
        properties.set(name, value);
      },
      removeProperty(name) {
        const previous = properties.get(name) ?? "";
        properties.delete(name);
        return previous;
      },
    },
  };
  return { root, properties };
}

function createThemeStorage(value: string | null = null) {
  let stored = value;
  const storage: ThemeStorage = {
    getItem() {
      return stored;
    },
    setItem(_key, nextValue) {
      stored = nextValue;
    },
  };
  return { storage, value: () => stored };
}

describe("built-in themes", () => {
  test("exposes system and complete six-color palettes", () => {
    expect(builtInThemes.length).toBeGreaterThanOrEqual(7);
    expect(builtInThemes[0]?.id).toBe("system");

    for (const theme of builtInThemes) {
      expect(isThemeId(theme.id)).toBe(true);
      expect(Object.keys(theme.preview)).toHaveLength(6);
      if ("colors" in theme) {
        expect(Object.keys(theme.colors)).toHaveLength(6);
      }
    }
    expect(isThemeId("unknown-theme")).toBe(false);
  });

  test("applies a palette and fully restores system behavior", () => {
    const { root, properties } = createThemeRoot();

    applyTheme("catppuccin-mocha", root);
    expect(root.dataset.theme).toBe("catppuccin-mocha");
    expect(root.style.colorScheme).toBe("dark");
    expect(properties.get("--bg")).toBe("#1E1E2E");
    expect(properties.get("--accent")).toBe("#CBA6F7");
    // Contrast-picked: mocha's light accent takes black button text.
    expect(properties.get("--button-fg")).toBe("#000000");

    applyTheme("system", root);
    expect(root.dataset.theme).toBe("system");
    expect(root.style.colorScheme).toBe("light dark");
    expect(properties.size).toBe(0);
  });

  test("persists a valid choice and ignores unknown stored values", () => {
    const { root } = createThemeRoot();
    const saved = createThemeStorage();

    saveThemePreference("nord", saved.storage, root);
    expect(saved.value()).toBe("nord");
    expect(readThemePreference(saved.storage)).toBe("nord");

    const unknown = createThemeStorage("not-real");
    expect(readThemePreference(unknown.storage)).toBe("system");
  });
});

describe("text size preference", () => {
  test("exposes the four sizes and validates ids", () => {
    expect(textSizes.map((size) => size.id)).toEqual([
      "small",
      "medium",
      "large",
      "xl",
    ]);
    expect(isTextSize("large")).toBe(true);
    expect(isTextSize("huge")).toBe(false);
  });

  test("applies the size to the root and persists valid choices", () => {
    const { root } = createThemeRoot();
    const saved = createThemeStorage();

    applyTextSize("xl", root);
    expect(root.dataset.fontSize).toBe("xl");

    saveTextSizePreference("large", saved.storage, root);
    expect(saved.value()).toBe("large");
    expect(root.dataset.fontSize).toBe("large");
    expect(readTextSizePreference(saved.storage)).toBe("large");

    const unknown = createThemeStorage("huge");
    expect(readTextSizePreference(unknown.storage)).toBe("medium");
  });
});

describe("theme derivation and contrast", () => {
  test("mixes colors and measures contrast like CSS", () => {
    expect(mixColors("#000000", 0.5, "#ffffff")).toBe("#808080");
    expect(mixColors("#ff0000", 1, "#00ff00")).toBe("#ff0000");
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  test("derives grounds and button text from the master colors", () => {
    const colors = {
      bg: "#ffffff",
      fg: "#19171c",
      accent: "#7a40ed",
      ok: "#2aa8b0",
      warn: "#f5a623",
      danger: "#e5484d",
    };

    const derived = resolveThemeDerived(colors, "light");
    expect(derived.buttonFg).toBe("#FFFFFF");
    expect(derived.link).toBe(colors.accent);
    expect(derived.attentionGround).toBe(
      mixColors(colors.warn, 0.06, colors.bg),
    );
    expect(derived.runningGround).toBe(
      mixColors(colors.accent, 0.18, colors.bg),
    );

    const darkColors = {
      ...colors,
      bg: "#19171c",
      fg: "#f4f1f7",
      accent: "#b48cff",
    };
    const dark = resolveThemeDerived(darkColors, "dark");
    expect(dark.attentionGround).toBe(
      mixColors(darkColors.warn, 0.15, darkColors.bg),
    );
    // A light accent takes black button text, not white.
    expect(dark.buttonFg).toBe("#000000");
  });

  test("every built-in palette passes the error-level contrast checks", () => {
    for (const theme of builtInThemes) {
      if (!("colors" in theme)) {
        continue;
      }
      const issues = validateThemeContrast(theme.colors, theme.appearance);
      const errors = issues.filter((issue) => issue.level === "error");
      expect(`${theme.id}: ${errors.map((e) => e.pair).join(", ")}`).toBe(
        `${theme.id}: `,
      );
    }
  });

  test("flags an illegible theme", () => {
    const bad = {
      bg: "#ffffff",
      fg: "#cccccc",
      accent: "#eeeeee",
      ok: "#ddffdd",
      warn: "#ffffcc",
      danger: "#ffdddd",
    };
    const errors = validateThemeContrast(bad, "light").filter(
      (issue) => issue.level === "error",
    );
    expect(errors.map((issue) => issue.pair)).toContain("text on background");
    expect(errors.map((issue) => issue.pair)).toContain("links on background");
  });
});
