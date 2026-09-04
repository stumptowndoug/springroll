import { describe, expect, test } from "bun:test";
import {
  compactInheritedModelLabel,
  defaultRecipeModelLabel,
  providerTypeLabel,
} from "../src/client/model-picker.tsx";

describe("compact model label", () => {
  test("shows the resolved app default instead of an ambiguous Default label", () => {
    expect(compactInheritedModelLabel("App default · GPT-5.6")).toBe("GPT-5.6");
    expect(compactInheritedModelLabel("App default · Automatic")).toBe(
      "Automatic",
    );
  });
});

describe("model provider presentation", () => {
  test("distinguishes aggregators, API keys, and subscriptions", () => {
    expect(providerTypeLabel("openrouter")).toBe("Aggregator");
    expect(providerTypeLabel("anthropic")).toBe("API key");
    expect(providerTypeLabel("claude")).toBe("Subscription");
    expect(providerTypeLabel("codex")).toBe("Subscription");
  });

  test("resolves the recipe default independently from chat", () => {
    expect(
      defaultRecipeModelLabel({
        providers: [],
        models: [],
        recipeModels: [
          {
            providerId: "claude",
            modelId: "sonnet",
            name: "Claude Sonnet",
            reasoning: true,
            toolCall: true,
            inputModalities: ["text"],
          },
        ],
        imageModels: [],
        defaultSelection: {
          providerId: "openrouter",
          modelId: "openai/gpt-5.4",
        },
        recipeDefaultSelection: {
          providerId: "claude",
          modelId: "sonnet",
        },
        catalogStale: false,
      }),
    ).toBe("Recipe default · Claude Sonnet");
  });
});
