import { describe, expect, test } from "bun:test";
import { MockImageModelV4 } from "ai/test";
import {
  AiSdkImageGenerationService,
  findImageModelDefinition,
} from "../src/image-generation.ts";

describe("AiSdkImageGenerationService", () => {
  test("maps Springroll orientation to AI SDK image settings", async () => {
    const calls: Array<{ size?: string; aspectRatio?: string }> = [];
    const bytes = pngHeader(640, 480);
    const model = new MockImageModelV4({
      provider: "openai",
      modelId: "gpt-image-2",
      doGenerate: async (options) => {
        calls.push({
          ...(options.size ? { size: options.size } : {}),
          ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        });
        return {
          images: [bytes],
          warnings: [],
          response: {
            timestamp: new Date("2026-08-19T12:00:00.000Z"),
            modelId: "gpt-image-2",
            headers: {},
          },
          usage: {
            inputTokens: 7,
            outputTokens: 11,
            totalTokens: 18,
          },
        };
      },
    });
    const definition = findImageModelDefinition("openai", "gpt-image-2");
    if (!definition) throw new Error("Missing test image model definition");
    const service = new AiSdkImageGenerationService(model, definition, {
      pricing: {
        inputUsdPerMillionTokens: 5,
        outputUsdPerMillionTokens: 30,
      },
      providerUsage: {
        read: () => ({
          costUsdMicros: 125_000,
          actualCostUsdMicros: 125_000,
          costSource: "provider_reported",
        }),
      },
    });

    const generated = await service.generate({
      prompt: "  A lighthouse in a storm  ",
      orientation: "landscape",
    });

    expect(calls).toEqual([{ size: "1536x1024" }]);
    expect(generated).toEqual({
      images: [{ bytes, mediaType: "image/png" }],
      providerId: "openai",
      modelId: "gpt-image-2",
      billing: "metered",
      inputTokens: 7,
      outputTokens: 11,
      totalTokens: 18,
      costUsdMicros: 125_000,
      actualCostUsdMicros: 125_000,
      estimatedCostUsdMicros: 365,
      costSource: "provider_reported",
    });
  });

  test("uses portable aspect ratios for OpenRouter and xAI image models", async () => {
    const definition = findImageModelDefinition(
      "openrouter",
      "google/gemini-3.1-flash-image",
      "Nano Banana 2",
    );
    expect(definition).toMatchObject({
      providerId: "openrouter",
      modelId: "google/gemini-3.1-flash-image",
      name: "Nano Banana 2",
      settings: {
        square: { aspectRatio: "1:1" },
        landscape: { aspectRatio: "16:9" },
        portrait: { aspectRatio: "9:16" },
      },
    });
    expect(findImageModelDefinition("xai", "grok-imagine-image")).toMatchObject(
      {
        providerId: "xai",
        modelId: "grok-imagine-image",
        settings: {
          square: { aspectRatio: "1:1" },
          landscape: { aspectRatio: "16:9" },
          portrait: { aspectRatio: "9:16" },
        },
      },
    );
  });

  test("passes reference images through the AI SDK image prompt", async () => {
    const generatedBytes = pngHeader(640, 480);
    const referenceBytes = pngHeader(320, 640);
    const model = new MockImageModelV4({
      provider: "openai",
      modelId: "gpt-image-2",
      doGenerate: async (options) => {
        expect(options.prompt).toBe("Restyle this portrait");
        expect(options.files).toEqual([
          { type: "file", mediaType: "image/png", data: referenceBytes },
        ]);
        return {
          images: [generatedBytes],
          warnings: [],
          response: {
            timestamp: new Date("2026-08-20T12:00:00.000Z"),
            modelId: "gpt-image-2",
            headers: {},
          },
          usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
          },
        };
      },
    });
    const definition = findImageModelDefinition("openai", "gpt-image-2");
    if (!definition) throw new Error("Missing test image model definition");

    await new AiSdkImageGenerationService(model, definition).generate({
      prompt: "Restyle this portrait",
      orientation: "portrait",
      references: [{ bytes: referenceBytes, mediaType: "image/png" }],
    });
  });
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
