import { expect, test } from "bun:test";
import { restoreAppearance } from "../src/client/appearance.ts";
import {
  readTextSizePreference,
  readThemePreference,
  type ThemeRoot,
} from "../src/client/themes.ts";
import type { AppearanceSettingsDto } from "../src/shared.ts";

function browser() {
  const values = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
    root: {
      dataset: {},
      style: {
        colorScheme: "",
        setProperty() {},
        removeProperty() {
          return "";
        },
      },
    } as ThemeRoot,
  };
}

test("theme and text size restore into fresh browser storage after an origin change", async () => {
  const saved = { theme: "springroll-dark-glass", textSize: "large" } as const;
  let writes = 0;
  const persistence = {
    appearance: async () => saved,
    updateAppearance: async () => {
      writes++;
      return saved;
    },
  };
  for (let launch = 0; launch < 2; launch++) {
    const fresh = browser();
    await restoreAppearance(persistence, fresh.storage, fresh.root);
    expect(readThemePreference(fresh.storage)).toBe(saved.theme);
    expect(readTextSizePreference(fresh.storage)).toBe("large");
    expect(fresh.root.dataset.glass).toBe("true");
    expect(fresh.root.dataset.fontSize).toBe("large");
  }
  expect(writes).toBe(0);
});

test("migrates local preferences once and preserves existing workspace choices", async () => {
  const fresh = browser();
  fresh.storage.setItem("springroll.theme", "kanagawa");
  fresh.storage.setItem("springroll.textSize", "xl");
  let saved: AppearanceSettingsDto = { theme: "system", textSize: null };
  await restoreAppearance(
    {
      appearance: async () => saved,
      updateAppearance: async (input) => {
        saved = { ...saved, ...input };
        return saved;
      },
    },
    fresh.storage,
    fresh.root,
  );
  expect(saved).toEqual({ theme: "system", textSize: "xl" });
  expect(readThemePreference(fresh.storage)).toBe("system");
});

test("startup still opens with cached appearance when the settings endpoint fails", async () => {
  const fresh = browser();
  fresh.storage.setItem("springroll.theme", "kanagawa");
  await restoreAppearance(
    {
      appearance: async () => {
        throw new Error("offline");
      },
      updateAppearance: async () => {
        throw new Error("unexpected write");
      },
    },
    fresh.storage,
    fresh.root,
  );
  expect(readThemePreference(fresh.storage)).toBe("kanagawa");
  expect(fresh.root.dataset.theme).toBe("kanagawa");
});
