import { describe, expect, test } from "bun:test";
import {
  applyTheme,
  builtInThemes,
  isThemeId,
  readThemePreference,
  saveThemePreference,
  type ThemeRoot,
  type ThemeStorage,
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
  test("exposes system and complete terminal color schemes", () => {
    expect(builtInThemes.length).toBeGreaterThanOrEqual(7);
    expect(builtInThemes[0]?.id).toBe("system");

    for (const theme of builtInThemes) {
      expect(isThemeId(theme.id)).toBe(true);
      expect(Object.keys(theme.preview)).toHaveLength(9);
      if (theme.id !== "system") {
        expect(Object.keys(theme.colors ?? {})).toHaveLength(9);
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
