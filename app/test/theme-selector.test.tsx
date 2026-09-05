import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolvedThemePreview,
  subscribeToSystemAppearance,
  ThemeSelector,
  themeCategory,
} from "../src/client/theme-selector.tsx";
import { builtInThemes } from "../src/client/themes.ts";

test("theme tiles use the real background and native theme selection controls", () => {
  for (const theme of builtInThemes) {
    const html = renderToStaticMarkup(
      <ThemeSelector value={theme.id} onChange={() => {}} />,
    );
    expect(html).toContain(`--swatch-bg:${theme.preview.bg}`);
    expect(html).toContain(`value="${theme.id}"`);
    expect(html).toContain('type="radio"');
    expect(html).toContain("Selected: ");
    expect(html).toContain('aria-label="Theme categories"');
    expect(html).toContain('class="theme-swatch-colors"');
  }
});

test("glass and system themes retain their own categories", () => {
  for (const theme of builtInThemes) {
    if ("glass" in theme && theme.glass)
      expect(themeCategory(theme)).toBe("Glass");
    else if (theme.appearance === "system")
      expect(themeCategory(theme)).toBe("System");
  }
});

test("System preview follows both appearances while explicit themes stay fixed", () => {
  const system = builtInThemes.find((theme) => theme.id === "system");
  if (!system) throw new Error("System theme missing");
  expect(resolvedThemePreview(system, true).bg).toBe("#1E1E1E");
  expect(resolvedThemePreview(system, false).bg).toBe("#FFFFFF");
  for (const theme of builtInThemes.filter((theme) => theme.id !== "system")) {
    expect(resolvedThemePreview(theme, true)).toEqual(theme.preview);
    expect(resolvedThemePreview(theme, false)).toEqual(theme.preview);
  }
});

test("appearance subscription reacts to changes and cleans up", () => {
  const query = new EventTarget();
  let changes = 0;
  const unsubscribe = subscribeToSystemAppearance(() => {
    changes += 1;
  }, query);
  query.dispatchEvent(new Event("change"));
  query.dispatchEvent(new Event("change"));
  expect(changes).toBe(2);
  unsubscribe();
  query.dispatchEvent(new Event("change"));
  expect(changes).toBe(2);
});
