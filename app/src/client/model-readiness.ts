import type { ModelSettingsDto } from "../shared.ts";

export function modelSetupSettingsPath(settings: ModelSettingsDto | undefined) {
  return modelSetupStage(settings) === "provider"
    ? "/settings?section=providers"
    : "/settings?section=models";
}

export function modelStartupRedirect(
  settings: ModelSettingsDto | undefined,
  pathname: string,
) {
  if (
    !settings ||
    modelSetupStage(settings) === "ready" ||
    (pathname !== "/" && pathname !== "/inbox")
  )
    return undefined;
  return modelSetupSettingsPath(settings);
}

export function modelSetupStage(settings: ModelSettingsDto | undefined) {
  if (!settings) return "loading";
  const connected = new Set(
    settings.providers.filter((p) => p.status === "connected").map((p) => p.id),
  );
  if (!connected.size) return "provider";
  const selection = settings.defaultSelection;
  return selection &&
    connected.has(selection.providerId) &&
    settings.recipeModels.some(
      (model) =>
        model.providerId === selection.providerId &&
        model.modelId === selection.modelId,
    )
    ? "ready"
    : "model";
}
