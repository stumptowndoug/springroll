import { describe, expect, test } from "bun:test";
import {
  chooseImageModel,
  chooseImageModelForCall,
} from "../src/server/image-model-selection.ts";
import type { ModelOptionDto } from "../src/shared.ts";

const model = (
  providerId: ModelOptionDto["providerId"],
  modelId: string,
): ModelOptionDto => ({
  providerId,
  modelId,
  name: modelId,
  reasoning: false,
  toolCall: false,
  inputModalities: ["text"],
});

describe("chooseImageModel", () => {
  const available = [
    model("openai", "gpt-image-2"),
    model("openrouter", "openrouter/auto"),
    model("openrouter", "openai/gpt-5-image-mini"),
  ];

  test("keeps an available explicit selection", () => {
    expect(
      chooseImageModel(available, {
        providerId: "openrouter",
        modelId: "openai/gpt-5-image-mini",
      })?.modelId,
    ).toBe("openai/gpt-5-image-mini");
  });

  test("uses a provider-maintained alias for Automatic", () => {
    expect(chooseImageModel(available)).toMatchObject({
      providerId: "openrouter",
      modelId: "openrouter/auto",
    });
  });

  test("falls back only within the supplied connected candidates", () => {
    expect(
      chooseImageModel([model("openrouter", "some/image-model")], {
        providerId: "openai",
        modelId: "gpt-image-2",
      }),
    ).toMatchObject({
      providerId: "openrouter",
      modelId: "some/image-model",
    });
    expect(chooseImageModel([])).toBeUndefined();
    expect(
      chooseImageModel([
        model("openrouter", "some/image-model"),
        model("openrouter", "another/image-model"),
      ]),
    ).toBeUndefined();
  });

  test("lets each tool call choose any connected image model", () => {
    expect(
      chooseImageModelForCall(
        available,
        { providerId: "openai", modelId: "gpt-image-2" },
        "openrouter:openai/gpt-5-image-mini",
      ),
    ).toMatchObject({
      providerId: "openrouter",
      modelId: "openai/gpt-5-image-mini",
    });
    expect(() =>
      chooseImageModelForCall(available, undefined, "openrouter:not-connected"),
    ).toThrow("not connected or compatible");
  });
});
