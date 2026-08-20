import { describe, expect, test } from "bun:test";
import {
  prepareAgentLoopStep,
  selectEmergencyBoundary,
} from "../src/agent-loop-policy.ts";

describe("agent loop policy", () => {
  test("strips round-tripped Gemini reasoning text before an OpenRouter continuation", () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "file" as const,
            data: imageBytes,
            mediaType: "image/png",
          },
        ],
      },
      {
        role: "assistant" as const,
        content: [
          {
            type: "reasoning" as const,
            text: "private reasoning",
            providerOptions: {
              openrouter: {
                reasoning_details: [
                  {
                    type: "reasoning.text",
                    format: "google-gemini-v1",
                    text: "private reasoning",
                    signature: "signed-but-not-safe-to-round-trip",
                  },
                  {
                    type: "reasoning.encrypted",
                    data: "opaque-continuity-token",
                  },
                ],
              },
            },
          },
          {
            type: "tool-call" as const,
            toolCallId: "image-1",
            toolName: "generate_image",
            input: { prompt: "A dog" },
            providerOptions: {
              openrouter: {
                reasoning_details: [
                  {
                    type: "reasoning.text",
                    format: "google-gemini-v1",
                    text: "private reasoning",
                    signature: "signed-but-not-safe-to-round-trip",
                  },
                  {
                    type: "reasoning.encrypted",
                    data: "opaque-continuity-token",
                  },
                ],
              },
            },
          },
        ],
      },
    ];

    const prepared = prepareAgentLoopStep({
      messages,
      instructions: "Continue after the tool call.",
      surface: "run",
      provider: "openrouter",
      modelId: "google/gemini-3.7-flash",
      cumulativeInputTokens: 10,
      maxCumulativeInputTokens: 100,
      elapsedMs: 10,
      maxActiveDurationMs: 1_000,
    });

    expect(JSON.stringify(prepared?.messages)).not.toContain(
      "google-gemini-v1",
    );
    expect(JSON.stringify(prepared?.messages)).toContain(
      "opaque-continuity-token",
    );
    expect(JSON.stringify(prepared?.messages)).toContain("generate_image");
    const preservedFile = prepared?.messages[0];
    expect(preservedFile?.role).toBe("user");
    if (
      preservedFile?.role !== "user" ||
      !Array.isArray(preservedFile.content)
    ) {
      throw new Error("Expected the input image message");
    }
    expect(preservedFile.content[0]?.type).toBe("file");
    if (preservedFile.content[0]?.type !== "file") {
      throw new Error("Expected the input image file");
    }
    expect(preservedFile.content[0].data).toEqual(imageBytes);
  });

  test("leaves other providers' reasoning metadata unchanged", () => {
    const prepared = prepareAgentLoopStep({
      messages: [{ role: "user", content: "Hello" }],
      instructions: "Reply.",
      surface: "chat",
      provider: "openrouter",
      modelId: "anthropic/claude-opus-4.6",
      cumulativeInputTokens: 0,
      maxCumulativeInputTokens: 100,
      elapsedMs: 0,
      maxActiveDurationMs: 1_000,
    });

    expect(prepared).toBeUndefined();
  });

  test("selects token, time, then step wrap-up in that order", () => {
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 20,
        maxCumulativeInputTokens: 20,
        elapsedMs: 5_000,
        maxActiveDurationMs: 1_000,
        stepNumber: 19,
        wrapUpFromStep: 19,
      }),
    ).toBe("context");
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 1,
        maxCumulativeInputTokens: 20,
        elapsedMs: 5_000,
        maxActiveDurationMs: 1_000,
        stepNumber: 19,
        wrapUpFromStep: 19,
      }),
    ).toBe("execution-time");
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 1,
        maxCumulativeInputTokens: 20,
        elapsedMs: 10,
        maxActiveDurationMs: 1_000,
        stepNumber: 19,
        wrapUpFromStep: 19,
      }),
    ).toBe("step-count");
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 1,
        maxCumulativeInputTokens: 20,
        elapsedMs: 10,
        maxActiveDurationMs: 1_000,
        stepNumber: 3,
        wrapUpFromStep: 19,
      }),
    ).toBeUndefined();
  });
});
