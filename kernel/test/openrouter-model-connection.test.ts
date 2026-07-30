import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/credentials.ts";
import { classifyFailure } from "../src/failures.ts";
import { MissingCredentialError } from "../src/model-connections/openai.ts";
import {
  defaultOpenRouterModelId,
  defaultOpenRouterModelPricing,
  OpenRouterModelConnection,
  openRouterApiKeyCreationUrl,
} from "../src/model-connections/openrouter.ts";

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

describe("OpenRouterModelConnection", () => {
  test("tests a key before storing it and loads an AI SDK chat model", async () => {
    const credentials = new MemoryCredentialStore();
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          data: {
            label: "sk-or-v1-test",
          },
        });
      },
    });

    const result = await connection.connect({
      credentialRef: "openrouter-default",
      apiKey: "  sk-or-v1-test-secret  ",
    });
    const model = await connection.loadModel("openrouter-default");

    expect(result).toEqual({
      provider: "openrouter",
      modelId: defaultOpenRouterModelId,
    });
    expect(requests).toEqual([
      {
        url: "https://openrouter.ai/api/v1/key",
        authorization: "Bearer sk-or-v1-test-secret",
      },
    ]);
    expect(credentials.values.get("openrouter-default")).toBe(
      "sk-or-v1-test-secret",
    );
    expect(model.provider).toBe("openrouter");
    expect(model.modelId).toBe(defaultOpenRouterModelId);
    expect(openRouterApiKeyCreationUrl).toBe(
      "https://openrouter.ai/settings/keys",
    );
    expect(defaultOpenRouterModelPricing).toEqual({
      inputUsdPerMillionTokens: 0.75,
      outputUsdPerMillionTokens: 4.5,
    });
  });

  test("does not store a key when the connection test fails", async () => {
    const credentials = new MemoryCredentialStore();
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async () => new Response(null, { status: 401 }),
      retry: {
        maxRetries: 0,
      },
    });

    await expect(
      connection.connect({
        credentialRef: "openrouter-default",
        apiKey: "sk-or-v1-invalid",
      }),
    ).rejects.toThrow("HTTP 401");
    expect(credentials.values.size).toBe(0);
  });

  test("classifies a missing stored key as an authentication failure", async () => {
    const connection = new OpenRouterModelConnection(
      new MemoryCredentialStore(),
    );

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
