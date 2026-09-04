import { describe, expect, test } from "bun:test";
import type { CredentialStore } from "../src/credentials.ts";
import {
  StandardModelConnection,
  type StandardModelProviderId,
  standardModelProviderDefinitions,
} from "../src/model-connections/standard.ts";

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

const cases: readonly {
  readonly providerId: StandardModelProviderId;
  readonly url: string;
  readonly header: readonly [string, string];
  readonly response: unknown;
  readonly runtimeProvider: string;
}[] = [
  {
    providerId: "anthropic",
    url: "https://api.anthropic.com/v1/models/claude-sonnet-4-6",
    header: ["x-api-key", "test-secret"],
    response: { id: "claude-sonnet-4-6" },
    runtimeProvider: "anthropic.messages",
  },
  {
    providerId: "google",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash",
    header: ["x-goog-api-key", "test-secret"],
    response: { name: "models/gemini-3.7-flash" },
    runtimeProvider: "google.generative-ai",
  },
  {
    providerId: "mistral",
    url: "https://api.mistral.ai/v1/models/mistral-medium-latest",
    header: ["authorization", "Bearer test-secret"],
    response: { id: "mistral-medium-latest" },
    runtimeProvider: "mistral.chat",
  },
  {
    providerId: "groq",
    url: "https://api.groq.com/openai/v1/models",
    header: ["authorization", "Bearer test-secret"],
    response: { data: [{ id: "openai/gpt-oss-120b" }] },
    runtimeProvider: "groq.chat",
  },
  {
    providerId: "deepseek",
    url: "https://api.deepseek.com/models",
    header: ["authorization", "Bearer test-secret"],
    response: { data: [{ id: "deepseek-v4-flash" }] },
    runtimeProvider: "deepseek.chat",
  },
  {
    providerId: "cohere",
    url: "https://api.cohere.com/v1/models?page_size=1000&endpoint=chat",
    header: ["authorization", "Bearer test-secret"],
    response: { models: [{ name: "command-a-03-2025" }] },
    runtimeProvider: "cohere.chat",
  },
];

describe("StandardModelConnection", () => {
  for (const item of cases) {
    test(`verifies and loads ${item.providerId}`, async () => {
      const credentials = new MemoryCredentialStore();
      const requests: Array<{
        readonly url: string;
        readonly header: string | null;
      }> = [];
      const connection = new StandardModelConnection(credentials, {
        fetch: async (input, init) => {
          requests.push({
            url: String(input),
            header: new Headers(init?.headers).get(item.header[0]),
          });
          return Response.json(item.response);
        },
      });
      const definition = standardModelProviderDefinitions[item.providerId];

      expect(
        await connection.connect({
          providerId: item.providerId,
          apiKey: "  test-secret  ",
        }),
      ).toEqual({
        provider: item.providerId,
        modelId: definition.defaultModelId,
      });
      const model = await connection.loadModel(item.providerId);
      const runtimeModel = model as { provider: string; modelId: string };

      expect(requests).toEqual([{ url: item.url, header: item.header[1] }]);
      expect(credentials.values.get(definition.credentialRef)).toBe(
        "test-secret",
      );
      expect(runtimeModel.provider).toBe(item.runtimeProvider);
      expect(runtimeModel.modelId).toBe(definition.defaultModelId);
    });
  }

  test("does not save a key that fails provider verification", async () => {
    const credentials = new MemoryCredentialStore();
    const connection = new StandardModelConnection(credentials, {
      fetch: async () => new Response(null, { status: 401 }),
      retry: { maxRetries: 0 },
    });

    await expect(
      connection.connect({ providerId: "anthropic", apiKey: "invalid" }),
    ).rejects.toThrow("HTTP 401");
    expect(credentials.values.size).toBe(0);
  });

  test("rejects malformed provider responses", async () => {
    const connection = new StandardModelConnection(
      new MemoryCredentialStore(),
      { fetch: async () => Response.json({ models: [] }) },
    );

    await expect(
      connection.connect({ providerId: "cohere", apiKey: "invalid" }),
    ).rejects.toThrow("invalid model response");
  });
});
