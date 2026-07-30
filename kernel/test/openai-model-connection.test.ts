import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/credentials.ts";
import { classifyFailure } from "../src/failures.ts";
import {
  defaultOpenAiModelId,
  defaultOpenAiModelPricing,
  MissingCredentialError,
  OpenAiModelConnection,
  openAiApiKeyCreationUrl,
} from "../src/model-connections/openai.ts";

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

describe("OpenAiModelConnection", () => {
  test("tests a key before storing it and loads an AI SDK Responses model", async () => {
    const credentials = new MemoryCredentialStore();
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const connection = new OpenAiModelConnection(credentials, {
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({ id: defaultOpenAiModelId });
      },
    });

    const result = await connection.connect({
      credentialRef: "openai-default",
      apiKey: "  sk-test-secret  ",
    });
    const model = await connection.loadModel("openai-default");

    expect(result).toEqual({
      provider: "openai",
      modelId: defaultOpenAiModelId,
    });
    expect(requests).toEqual([
      {
        url: `https://api.openai.com/v1/models/${defaultOpenAiModelId}`,
        authorization: "Bearer sk-test-secret",
      },
    ]);
    expect(credentials.values.get("openai-default")).toBe("sk-test-secret");
    expect(model.provider).toBe("openai.responses");
    expect(model.modelId).toBe(defaultOpenAiModelId);
    expect(openAiApiKeyCreationUrl).toBe(
      "https://platform.openai.com/api-keys",
    );
    expect(defaultOpenAiModelPricing).toEqual({
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
    });
  });

  test("does not store a key when the connection test fails", async () => {
    const credentials = new MemoryCredentialStore();
    const connection = new OpenAiModelConnection(credentials, {
      fetch: async () => new Response(null, { status: 401 }),
      retry: {
        maxRetries: 0,
      },
    });

    await expect(
      connection.connect({
        credentialRef: "openai-default",
        apiKey: "sk-invalid",
      }),
    ).rejects.toThrow("HTTP 401");
    expect(credentials.values.size).toBe(0);
  });

  test("classifies a missing stored key as an authentication failure", async () => {
    const connection = new OpenAiModelConnection(new MemoryCredentialStore());

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
