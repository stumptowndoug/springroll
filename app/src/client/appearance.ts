import { api } from "./api.ts";
import {
  isTextSize,
  isThemeId,
  loadTextSizePreference,
  loadThemePreference,
  saveTextSizePreference,
  saveThemePreference,
  type ThemeRoot,
  type ThemeStorage,
} from "./themes.ts";

/** Browser storage is a cache; the workspace survives desktop origin changes. */
export async function restoreAppearance(
  persistence: Pick<typeof api, "appearance" | "updateAppearance"> = api,
  storage: ThemeStorage = window.localStorage,
  root: ThemeRoot = document.documentElement,
) {
  const localTheme = loadThemePreference(storage, root);
  const localSize = loadTextSizePreference(storage, root);
  try {
    const saved = await persistence.appearance();
    if (isThemeId(saved.theme)) saveThemePreference(saved.theme, storage, root);
    if (isTextSize(saved.textSize))
      saveTextSizePreference(saved.textSize, storage, root);
    // Read through an existing browser choice once, without overwriting saved values.
    if (saved.theme === null || saved.textSize === null) {
      await persistence.updateAppearance({
        ...(saved.theme === null ? { theme: localTheme } : {}),
        ...(saved.textSize === null ? { textSize: localSize } : {}),
      });
    }
  } catch {
    // An unavailable server must not prevent the app from opening.
  }
}
