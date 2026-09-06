import { expect, test } from "bun:test";
import { showsChatLauncher } from "../src/client/chat-session-entry.ts";
import {
  modelSetupStage,
  modelStartupRedirect,
} from "../src/client/model-readiness.ts";
import type { ModelSettingsDto } from "../src/shared.ts";

const model = {
  providerId: "openai" as const,
  modelId: "test",
  name: "Test model",
  reasoning: false,
  toolCall: true,
  inputModalities: ["text"],
};
const settings: ModelSettingsDto = {
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      status: "connected",
      kind: "direct_api",
      keyCreationUrl: "https://example.com",
      keyPlaceholder: "Key",
    },
  ],
  models: [model],
  recipeModels: [model],
  imageModels: [],
  catalogStale: false,
};

test("startup opens the relevant Settings section without hijacking deep links", () => {
  expect(modelStartupRedirect(undefined, "/")).toBeUndefined();
  expect(modelStartupRedirect({ ...settings, providers: [] }, "/inbox")).toBe(
    "/settings?section=providers",
  );
  expect(modelStartupRedirect(settings, "/")).toBe("/settings?section=models");
  expect(
    modelStartupRedirect({ ...settings, defaultSelection: model }, "/inbox"),
  ).toBeUndefined();
  for (const path of ["/settings", "/recipes", "/chat/existing"]) {
    expect(modelStartupRedirect(settings, path)).toBeUndefined();
  }
});

test("setup requires a connected provider and an available explicit default", () => {
  expect(showsChatLauncher("/setup")).toBe(false);
  expect(modelSetupStage(undefined)).toBe("loading");
  expect(modelSetupStage({ ...settings, providers: [] })).toBe("provider");
  expect(modelSetupStage(settings)).toBe("model");
  expect(modelSetupStage({ ...settings, defaultSelection: model })).toBe(
    "ready",
  );
});

test("the reminder progresses from provider to default model and only then clears", () => {
  const stages = [
    {
      ...settings,
      providers: settings.providers.map((p) => ({
        ...p,
        status: "not_connected" as const,
      })),
    },
    settings,
    { ...settings, defaultSelection: model },
  ].map(modelSetupStage);
  expect(stages).toEqual(["provider", "model", "ready"]);
});

test("disconnects and unavailable defaults return to setup instead of trusting dismissal", () => {
  expect(
    modelSetupStage({
      ...settings,
      defaultSelection: model,
      providers: settings.providers.map((provider) => ({
        ...provider,
        status: "not_connected",
      })),
    }),
  ).toBe("provider");
  expect(
    modelSetupStage({
      ...settings,
      defaultSelection: { ...model, modelId: "removed" },
    }),
  ).toBe("model");
  expect(
    modelSetupStage({ ...settings, defaultSelection: model, recipeModels: [] }),
  ).toBe("model");
});
