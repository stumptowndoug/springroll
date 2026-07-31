import { describe, expect, test } from "bun:test";
import {
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
} from "@shrimp-roll/kernel";
import {
  chooseModelExecution,
  chooseModelSelection,
} from "../src/server/model-selection.ts";

const automaticSelections = [
  { providerId: "openrouter", modelId: "openai/gpt-5.4-mini" },
  { providerId: "openai", modelId: "gpt-5.6-sol" },
  { providerId: "xai", modelId: "grok-4.5" },
] as const;

describe("chooseModelSelection", () => {
  test("uses OpenRouter managed search for an automatic web task", () => {
    expect(
      chooseModelSelection({
        automaticSelections,
        connectedProviders: new Set(["openrouter", "xai"]),
        requiredCapabilities: [
          webSearchProviderToolCapability,
          webFetchProviderToolCapability,
        ],
      }),
    ).toEqual({
      providerId: "openrouter",
      modelId: "openai/gpt-5.4-mini",
    });
  });

  test("preserves a compatible selected model", () => {
    expect(
      chooseModelSelection({
        defaultSelection: {
          providerId: "openrouter",
          modelId: "x-ai/grok-4.5",
        },
        automaticSelections,
        connectedProviders: new Set(["openrouter", "xai"]),
        requiredCapabilities: [webSearchProviderToolCapability],
      }),
    ).toEqual({
      providerId: "openrouter",
      modelId: "x-ai/grok-4.5",
    });
  });

  test("blocks an incompatible selected model instead of substituting OpenRouter", () => {
    expect(() =>
      chooseModelSelection({
        defaultSelection: {
          providerId: "xai",
          modelId: "grok-4.5",
        },
        automaticSelections,
        connectedProviders: new Set(["openrouter", "xai"]),
        requiredCapabilities: [webSearchProviderToolCapability],
      }),
    ).toThrow(
      "The selected xai model grok-4.5 cannot currently provide web.search. ShrimpRoll did not substitute another model.",
    );
  });

  test("preserves a direct selected model when portable web tools are connected", () => {
    expect(
      chooseModelSelection({
        defaultSelection: {
          providerId: "xai",
          modelId: "grok-4.5",
        },
        automaticSelections,
        connectedProviders: new Set(["openrouter", "xai"]),
        requiredCapabilities: [
          webSearchProviderToolCapability,
          webFetchProviderToolCapability,
        ],
        portableCapabilities: new Set([
          webSearchProviderToolCapability,
          webFetchProviderToolCapability,
        ]),
      }),
    ).toEqual({
      providerId: "xai",
      modelId: "grok-4.5",
    });
  });

  test("explains that direct Grok stays selected while Exa provides web tools", () => {
    expect(
      chooseModelExecution({
        taskSelection: {
          providerId: "xai",
          modelId: "grok-4.5",
        },
        automaticSelections,
        connectedProviders: new Set(["openrouter", "xai"]),
        requiredCapabilities: [
          webSearchProviderToolCapability,
          webFetchProviderToolCapability,
        ],
        portableCapabilities: new Set([
          webSearchProviderToolCapability,
          webFetchProviderToolCapability,
        ]),
      }),
    ).toEqual({
      providerId: "xai",
      modelId: "grok-4.5",
      selectedBy: "task",
      toolRoutes: [
        {
          capability: "web.search",
          profile: "portable",
          service: "exa",
        },
        {
          capability: "web.fetch",
          profile: "portable",
          service: "exa",
        },
      ],
    });
  });

  test("blocks a disconnected selected model instead of changing providers", () => {
    expect(() =>
      chooseModelSelection({
        defaultSelection: {
          providerId: "xai",
          modelId: "grok-4.5",
        },
        automaticSelections,
        connectedProviders: new Set(["openrouter"]),
        requiredCapabilities: [],
      }),
    ).toThrow("The selected xai model grok-4.5 is not connected");
  });
});
