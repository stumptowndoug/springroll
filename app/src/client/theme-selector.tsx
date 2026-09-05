import { type CSSProperties, useState, useSyncExternalStore } from "react";
import { builtInThemes, type ThemeDefinition, type ThemeId } from "./themes.ts";

const categories = ["System", "Light", "Dark", "Glass", "All"] as const;
type Category = (typeof categories)[number];

const darkAppearanceQuery = "(prefers-color-scheme: dark)";
export function subscribeToSystemAppearance(
  onChange: () => void,
  query: EventTarget = window.matchMedia(darkAppearanceQuery),
): () => void {
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function systemPrefersDark(): boolean {
  return window.matchMedia(darkAppearanceQuery).matches;
}

export function resolvedThemePreview(theme: ThemeDefinition, dark: boolean) {
  return theme.appearance === "system"
    ? (builtInThemes.find(
        (candidate) =>
          candidate.id === (dark ? "springroll-dark" : "springroll-light"),
      )?.preview ?? theme.preview)
    : theme.preview;
}

export function themeCategory(theme: ThemeDefinition): Category {
  return theme.glass
    ? "Glass"
    : theme.appearance === "system"
      ? "System"
      : theme.appearance === "light"
        ? "Light"
        : "Dark";
}

export function ThemeSelector({
  value,
  onChange,
}: {
  readonly value: ThemeId;
  readonly onChange: (value: ThemeId) => void;
}) {
  const systemDark = useSyncExternalStore(
    subscribeToSystemAppearance,
    systemPrefersDark,
    () => false,
  );
  const selected = builtInThemes.find((theme) => theme.id === value);
  const [category, setCategory] = useState<Category>(() =>
    selected ? themeCategory(selected) : "All",
  );
  const visible = builtInThemes
    .filter((theme) => category === "All" || themeCategory(theme) === category)
    .map((theme) => ({
      ...theme,
      preview: resolvedThemePreview(theme, systemDark),
    }));
  return (
    <div className="theme-selector">
      <nav className="theme-category-filters" aria-label="Theme categories">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <div
        className="theme-swatch-grid"
        role="radiogroup"
        aria-label={`${category} themes`}
      >
        {visible.map((theme) => (
          <label className="theme-swatch-option" key={theme.id}>
            <input
              type="radio"
              name="appearance-theme"
              value={theme.id}
              checked={value === theme.id}
              onChange={() => onChange(theme.id)}
            />
            <span
              className="theme-swatch-preview"
              aria-hidden="true"
              style={
                {
                  "--swatch-bg": theme.preview.bg,
                  "--swatch-fg": theme.preview.fg,
                } as CSSProperties
              }
            >
              <span className="theme-swatch-text">Aa</span>
              <span className="theme-swatch-colors">
                {(["accent", "run", "ok", "warn", "danger"] as const).map(
                  (role) => (
                    <i key={role} style={{ background: theme.preview[role] }} />
                  ),
                )}
              </span>
            </span>
            <span className="theme-swatch-name">
              {theme.name}
              <span className="theme-swatch-check" aria-hidden="true">
                ✓
              </span>
            </span>
            <span className="theme-swatch-kind">
              {theme.appearance === "system"
                ? `Automatic · ${systemDark ? "Dark" : "Light"} now`
                : themeCategory(theme)}
            </span>
          </label>
        ))}
      </div>
      <p className="theme-current-selection">
        Selected: {selected?.name ?? "System"}
        {selected?.appearance === "system"
          ? ` · Follows this Mac’s appearance · ${systemDark ? "Dark" : "Light"} now`
          : ""}
      </p>
    </div>
  );
}
