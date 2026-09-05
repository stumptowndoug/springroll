import { describe, expect, test } from "bun:test";
import { generateText } from "ai";
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
    providerId: "groq",
    url: "https://api.groq.com/openai/v1/models",
    header: ["authorization", "Bearer test-secret"],
    response: { data: [{ id: "openai/gpt-oss-120b" }] },
    runtimeProvider: "groq.chat",
  },
];

describe("StandardModelConnection", () => {
  test("persists the Anthropic workspace and sends it during verification and inference", async () => {
    const credentials = new MemoryCredentialStore();
    const requests: {
      url: string;
      workspace: string | null;
      key: string | null;
    }[] = [];
    const fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        workspace: headers.get("anthropic-workspace-id"),
        key: headers.get("x-api-key"),
      });
      return String(input).endsWith("/messages")
        ? Response.json({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "Ready" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          })
        : Response.json({ id: "claude-sonnet-4-6" });
    };
    const connection = new StandardModelConnection(credentials, { fetch });
    await connection.connect({
      providerId: "anthropic",
      apiKey: " test-secret ",
      workspaceId: " wrkspc_test123 ",
    });
    const reloaded = new StandardModelConnection(credentials, { fetch });
    await reloaded.test("anthropic");
    const result = await generateText({
      model: await reloaded.loadModel("anthropic"),
      prompt: "Hello",
      maxRetries: 0,
    });
    expect(result.text).toBe("Ready");
    expect(requests).toHaveLength(3);
    expect(
      requests.every(
        (request) =>
          request.workspace === "wrkspc_test123" &&
          request.key === "test-secret",
      ),
    ).toBe(true);
    expect(requests[2]?.url).toBe("https://api.anthropic.com/v1/messages");
    await reloaded.disconnect("anthropic");
    expect(credentials.values.size).toBe(0);
    await reloaded.connect({ providerId: "anthropic", apiKey: "scoped-key" });
    expect(requests.at(-1)?.workspace).toBeNull();
    expect(credentials.values.get("anthropic-default")).toBe("scoped-key");
  });

  test("explains a missing workspace without exposing the provider's response", async () => {
    const credentials = new MemoryCredentialStore();
    const connection = new StandardModelConnection(credentials, {
      fetch: async () =>
        Response.json(
          {
            error: {
              message: "anthropic-workspace-id is required; secret-key",
            },
          },
          { status: 400 },
        ),
      retry: { maxRetries: 0 },
    });
    await expect(
      connection.connect({ providerId: "anthropic", apiKey: "secret-key" }),
    ).rejects.toThrow("This Anthropic key requires a Workspace ID.");
    expect(credentials.values.size).toBe(0);
  });

  test("rejects invalid workspace IDs before making requests or replacing saved credentials", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.values.set("anthropic-default", "existing-key");
    let requests = 0;
    const connection = new StandardModelConnection(credentials, {
      fetch: async () => {
        requests++;
        return Response.json({});
      },
    });
    await expect(
      connection.connect({
        providerId: "anthropic",
        apiKey: "new-key",
        workspaceId: "bad\r\nheader",
      }),
    ).rejects.toThrow("valid Anthropic Workspace ID");
    expect(requests).toBe(0);
    expect(credentials.values.get("anthropic-default")).toBe("existing-key");
  });

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
      connection.connect({ providerId: "anthropic", apiKey: "invalid" }),
    ).rejects.toThrow("invalid model response");
  });
});
