import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  resolveRollmarkChartColors,
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
  test("exposes system and complete seven-color palettes", () => {
    expect(builtInThemes.length).toBeGreaterThanOrEqual(7);
    expect(builtInThemes[0]?.id).toBe("system");

    for (const theme of builtInThemes) {
      expect(isThemeId(theme.id)).toBe(true);
      expect(
        Object.keys(theme.preview).filter((name) => name !== "chartSeries"),
      ).toHaveLength(7);
      if ("colors" in theme) {
        expect(
          Object.keys(theme.colors).filter((name) => name !== "chartSeries"),
        ).toHaveLength(7);
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

    saveThemePreference("kanagawa", saved.storage, root);
    expect(saved.value()).toBe("kanagawa");
    expect(readThemePreference(saved.storage)).toBe("kanagawa");

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
      run: "#d98232",
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
    expect(derived.runningGround).toBe(mixColors(colors.run, 0.18, colors.bg));

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

  test("derives eight contrasting Rollmark series colors from every theme", () => {
    for (const theme of builtInThemes) {
      const chart = resolveRollmarkChartColors(theme.preview);

      expect(chart.series).toHaveLength(8);
      expect(new Set(chart.series).size).toBe(8);
      expect(chart.text).toBe(theme.preview.fg);
      for (const color of chart.series) {
        expect(contrastRatio(color, theme.preview.bg)).toBeGreaterThanOrEqual(
          3,
        );
      }
    }
  });

  test("adds complementary Springroll chart colors without changing UI colors", () => {
    for (const [id, background, accent, additions] of [
      [
        "springroll-light",
        "#FFFFFF",
        "#357953",
        ["#3978C6", "#8B5CB5", "#21858C", "#BE587C"],
      ],
      [
        "springroll-dark",
        "#1E1E1E",
        "#4db07a",
        ["#79ACEE", "#B99ADD", "#67C2C9", "#E58FAA"],
      ],
    ] as const) {
      const theme = builtInThemes.find((candidate) => candidate.id === id);
      if (!theme) throw new Error(`Missing ${id}`);
      expect(theme.preview.bg).toBe(background);
      expect(theme.preview.accent).toBe(accent);
      expect(
        resolveRollmarkChartColors(theme.preview).series.slice(2, 6),
      ).toEqual([...additions]);
      const { root, properties } = createThemeRoot();
      applyTheme(id, root);
      expect(properties.has("--chartSeries")).toBe(false);
      expect(properties.get("--bg")).toBe(background);
      expect(properties.get("--accent")).toBe(accent);
    }
  });

  test("preserves the derived chart palette for other themes", () => {
    const theme = builtInThemes.find(
      (candidate) => candidate.id === "catppuccin-mocha",
    );
    if (!theme) throw new Error("Missing Catppuccin");
    const colors = theme.preview;
    expect(resolveRollmarkChartColors(colors).series).toEqual([
      colors.accent,
      colors.run,
      colors.ok,
      colors.warn,
      colors.danger,
      mixColors(colors.accent, 0.62, colors.fg),
      mixColors(colors.run, 0.62, colors.fg),
      mixColors(colors.ok, 0.62, colors.fg),
    ]);
  });

  test("flags an illegible theme", () => {
    const bad = {
      bg: "#ffffff",
      fg: "#cccccc",
      accent: "#eeeeee",
      run: "#ffddaa",
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

/*
 * The standard palettes live in two places: themes.ts (picked themes) and
 * the design-system.css literals (the System theme + first paint). They
 * have drifted apart four times; this suite makes drift a test failure.
 */
describe("CSS default palettes stay in sync with the standard pair", () => {
  const css = readFileSync(
    new URL("../src/client/design-system.css", import.meta.url),
    "utf8",
  );
  const tokenMatches = [
    ...css.matchAll(/--(bg|fg|accent|run|ok|warn|danger): (#[0-9a-fA-F]{6})/g),
  ];
  const cssLight: Record<string, string> = {};
  const cssDark: Record<string, string> = {};
  for (const [, name, value] of tokenMatches) {
    if (name === undefined || value === undefined) {
      continue;
    }
    if (cssLight[name] === undefined) {
      cssLight[name] = value.toLowerCase();
    } else if (cssDark[name] === undefined) {
      cssDark[name] = value.toLowerCase();
    }
  }
  const buttonFgMatches = [
    ...css.matchAll(/--button-fg: (#[0-9a-fA-F]{6})/g),
  ].map((match) => match[1]?.toLowerCase());

  const lightTheme = builtInThemes.find(
    (theme) => theme.id === "springroll-light",
  );
  const darkTheme = builtInThemes.find(
    (theme) => theme.id === "springroll-dark",
  );

  test("light block matches springroll-light", () => {
    if (!lightTheme || !("colors" in lightTheme)) throw new Error("missing");
    for (const [name, value] of Object.entries(lightTheme.colors)) {
      if (typeof value !== "string") continue;
      expect(`${name}: ${cssLight[name]}`).toBe(
        `${name}: ${value.toLowerCase()}`,
      );
    }
  });

  test("dark block matches springroll-dark", () => {
    if (!darkTheme || !("colors" in darkTheme)) throw new Error("missing");
    for (const [name, value] of Object.entries(darkTheme.colors)) {
      if (typeof value !== "string") continue;
      expect(`${name}: ${cssDark[name]}`).toBe(
        `${name}: ${value.toLowerCase()}`,
      );
    }
  });

  test("CSS button text matches the derived pick for both appearances", () => {
    if (!lightTheme || !("colors" in lightTheme)) throw new Error("missing");
    if (!darkTheme || !("colors" in darkTheme)) throw new Error("missing");
    expect(buttonFgMatches[0]).toBe(
      resolveThemeDerived(lightTheme.colors, "light").buttonFg.toLowerCase(),
    );
    expect(buttonFgMatches[1]).toBe(
      resolveThemeDerived(darkTheme.colors, "dark").buttonFg.toLowerCase(),
    );
  });
});
