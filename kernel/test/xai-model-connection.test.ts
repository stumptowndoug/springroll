import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/credentials.ts";
import { classifyFailure } from "../src/failures.ts";
import { MissingCredentialError } from "../src/model-connections/openai.ts";
import {
  defaultXaiModelId,
  XaiModelConnection,
  xaiApiKeyCreationUrl,
} from "../src/model-connections/xai.ts";

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();

  async get(reference: string): Promise<string | undefined> {
    return this.values.get(reference);
  }

  async put(reference: string, secret: string): Promise<void> {
    this.values.set(reference, secret);
  }

  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

describe("XaiModelConnection", () => {
  test("verifies the selected model, reads current pricing, and loads an AI SDK chat model", async () => {
    const credentials = new MemoryCredentialStore();
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const connection = new XaiModelConnection(credentials, {
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          id: defaultXaiModelId,
          object: "model",
          prompt_text_token_price: 12_500,
          completion_text_token_price: 25_000,
        });
      },
    });

    const connected = await connection.connect({
      credentialRef: "xai-default",
      apiKey: "  xai-test-secret  ",
    });
    const runtime = await connection.loadAgentRuntime("xai-default");

    expect(connected).toEqual({
      provider: "xai",
      modelId: defaultXaiModelId,
      pricing: {
        inputUsdPerMillionTokens: 1.25,
        outputUsdPerMillionTokens: 2.5,
      },
    });
    expect(requests).toEqual([
      {
        url: `https://api.x.ai/v1/models/${defaultXaiModelId}`,
        authorization: "Bearer xai-test-secret",
      },
      {
        url: `https://api.x.ai/v1/models/${defaultXaiModelId}`,
        authorization: "Bearer xai-test-secret",
      },
    ]);
    expect(credentials.values.get("xai-default")).toBe("xai-test-secret");
    expect(runtime.model.provider).toBe("xai.chat");
    expect(runtime.model.modelId).toBe(defaultXaiModelId);
    expect(runtime.pricing).toEqual({
      inputUsdPerMillionTokens: 1.25,
      outputUsdPerMillionTokens: 2.5,
    });
    expect(xaiApiKeyCreationUrl).toBe("https://console.x.ai/home");
  });

  test("does not store a key when the connection test fails", async () => {
    const credentials = new MemoryCredentialStore();
    const connection = new XaiModelConnection(credentials, {
      fetch: async () => new Response(null, { status: 401 }),
      retry: {
        maxRetries: 0,
      },
    });

    await expect(
      connection.connect({
        credentialRef: "xai-default",
        apiKey: "xai-invalid",
      }),
    ).rejects.toThrow("HTTP 401");
    expect(credentials.values.size).toBe(0);
  });

  test("classifies a missing stored key as an authentication failure", async () => {
    const connection = new XaiModelConnection(new MemoryCredentialStore());

    try {
      await connection.test("missing");
      throw new Error("connection test should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingCredentialError);
      expect(classifyFailure(error)).toEqual({
        category: "authentication",
        retryable: false,
      });
    }
  });
});
