import { describe, expect, test } from "bun:test";
import { generateImage, streamText } from "ai";
import { prepareAgentLoopStep } from "../src/agent-loop-policy.ts";
import { AiSdkAgentRunner } from "../src/ai-sdk-agent-runner.ts";
import type { Task } from "../src/contracts.ts";
import type { CredentialStore } from "../src/credentials.ts";
import { classifyFailure } from "../src/failures.ts";
import { MissingCredentialError } from "../src/model-connections/openai.ts";
import {
  defaultOpenRouterModelId,
  defaultOpenRouterModelPricing,
  OpenRouterModelConnection,
  openRouterApiKeyCreationUrl,
} from "../src/model-connections/openrouter.ts";
import {
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
} from "../src/provider-tools.ts";
import type { ExecutableTool } from "../src/tools.ts";

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
    const imageModel = await connection.loadImageModel(
      "openrouter-default",
      "google/gemini-3.1-flash-image",
    );

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
    expect(imageModel.provider).toBe("openrouter");
    expect(imageModel.modelId).toBe("google/gemini-3.1-flash-image");
    expect(openRouterApiKeyCreationUrl).toBe(
      "https://openrouter.ai/settings/keys",
    );
    expect(defaultOpenRouterModelPricing).toEqual({
      inputUsdPerMillionTokens: 0.75,
      outputUsdPerMillionTokens: 4.5,
    });
  });

  test("accepts a replacement key after disconnecting", async () => {
    const credentials = new MemoryCredentialStore();
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async () => Response.json({ data: { label: "replacement" } }),
    });
    await connection.connect({
      credentialRef: "openrouter-default",
      apiKey: "sk-old",
    });
    await connection.disconnect("openrouter-default");
    expect(await credentials.get("openrouter-default")).toBeUndefined();
    await connection.connect({
      credentialRef: "openrouter-default",
      apiKey: " sk-new ",
    });
    expect(await credentials.get("openrouter-default")).toBe("sk-new");
    expect((await connection.loadModel("openrouter-default")).modelId).toBe(
      defaultOpenRouterModelId,
    );
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

  test("sends only valid Gemini continuation metadata without an OpenRouter warning", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.values.set("openrouter-default", "sk-or-v1-test-secret");
    const requestBodies: Record<string, unknown>[] = [];
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async (_input, init) => {
        requestBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        const chunks = [
          {
            id: "generation-gemini-retry",
            model: "google/gemini-3.7-flash",
            provider: "Google",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Recovered." },
                finish_reason: null,
              },
            ],
          },
          {
            id: "generation-gemini-retry",
            model: "google/gemini-3.7-flash",
            provider: "Google",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
            },
          },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const runtime = await connection.loadAgentRuntime(
      "openrouter-default",
      "google/gemini-3.7-flash",
    );
    const reasoningDetails = [
      {
        type: "reasoning.text",
        format: "google-gemini-v1",
        text: "Call the lookup tool.",
        signature: "valid-thought-signature",
      },
      {
        type: "reasoning.encrypted",
        format: "google-gemini-v1",
        data: "stale-encrypted-reasoning",
      },
    ];
    const prepared = prepareAgentLoopStep({
      messages: [
        { role: "user", content: "Look this up" },
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "Call the lookup tool.",
              providerOptions: {
                openrouter: { reasoning_details: reasoningDetails },
              },
            },
            {
              type: "tool-call",
              toolCallId: "lookup-1",
              toolName: "lookup",
              input: {},
              providerOptions: {
                openrouter: { reasoning_details: reasoningDetails },
              },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "lookup-1",
              toolName: "lookup",
              output: { type: "json", value: { result: "found" } },
            },
          ],
        },
      ],
      instructions: "Answer from the lookup.",
      surface: "chat",
      provider: "openrouter",
      modelId: "google/gemini-3.7-flash",
      cumulativeInputTokens: 10,
      maxCumulativeInputTokens: 100,
      elapsedMs: 10,
      maxActiveDurationMs: 1_000,
    });
    if (!prepared?.messages) throw new Error("Expected sanitized messages");
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => {
      warnings.push(values.map(String).join(" "));
    };
    try {
      const result = streamText({
        model: runtime.model,
        messages: prepared.messages,
        maxRetries: 0,
      });
      expect(await result.text).toBe("Recovered.");
    } finally {
      console.warn = originalWarn;
    }

    const request = JSON.stringify(requestBodies[0]);
    expect(request).toContain("valid-thought-signature");
    expect(request).not.toContain("stale-encrypted-reasoning");
    expect(warnings.join("\n")).not.toContain("[openrouter]");
  });

  test("generates through OpenRouter's AI SDK image model", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.values.set("openrouter-default", "sk-or-v1-test-secret");
    const requests: Array<{ url: string; body: unknown }> = [];
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as unknown,
        });
        return Response.json({
          data: [
            {
              b64_json: Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
              ]).toString("base64"),
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 8,
            total_tokens: 12,
            cost: 0.13,
          },
        });
      },
    });
    const runtime = await connection.loadImageRuntime(
      "openrouter-default",
      "google/gemini-3.1-flash-image",
    );

    const generated = await generateImage({
      model: runtime.model,
      prompt: "A happy dog",
      aspectRatio: "16:9",
    });

    expect(requests).toEqual([
      {
        url: "https://openrouter.ai/api/v1/images",
        body: {
          model: "google/gemini-3.1-flash-image",
          prompt: "A happy dog",
          n: 1,
          aspect_ratio: "16:9",
        },
      },
    ]);
    expect(generated.images[0]?.uint8Array).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(generated.usage).toEqual({
      inputTokens: 4,
      outputTokens: 8,
      totalTokens: 12,
    });
    expect(runtime.providerUsage.read()).toEqual({
      inputTokens: 4,
      outputTokens: 8,
      totalTokens: 12,
      costUsdMicros: 130_000,
      actualCostUsdMicros: 130_000,
      costSource: "provider_reported",
    });
  });

  test("passes agent-controlled web server tools through the AI SDK", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.values.set("openrouter-default", "sk-or-v1-test-secret");
    const requestBodies: Record<string, unknown>[] = [];
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async (_input, init) => {
        const requestBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        requestBodies.push(requestBody);
        const isTerminalRequest = requestBody.response_format !== undefined;
        const chunks = [
          {
            id: "generation-web",
            model: defaultOpenRouterModelId,
            provider: "OpenAI",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "generation-web",
            model: defaultOpenRouterModelId,
            provider: "OpenAI",
            choices: [
              {
                index: 0,
                delta: {
                  content: isTerminalRequest
                    ? JSON.stringify({
                        reportMarkdown:
                          "Current search results support the report.",
                        summary: "Current search results support the report.",
                        disposition: "informational",
                      })
                    : "Current search results support the report.",
                  annotations: isTerminalRequest
                    ? undefined
                    : [
                        {
                          type: "url_citation",
                          url_citation: {
                            url: "https://trends.google.com/trending",
                            title: "Trending Now - Google Trends",
                            start_index: 0,
                            end_index: 39,
                          },
                        },
                      ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: "generation-web",
            model: defaultOpenRouterModelId,
            provider: "OpenAI",
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 6,
              total_tokens: 16,
              cost: isTerminalRequest ? 0.0001 : 0.001234,
              ...(isTerminalRequest
                ? {}
                : {
                    server_tool_use: {
                      web_search_requests: 1,
                    },
                  }),
            },
          },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      },
    });
    const runtime = await connection.loadAgentRuntime(
      "openrouter-default",
      defaultOpenRouterModelId,
    );
    const task: Task = {
      id: "task-trends",
      prompt: "Research today's fastest-rising search topics.",
      enabled: true,
      nextRunAt: new Date("2026-07-31T15:00:00.000Z"),
      catchUpPolicy: "skip_to_next",
      tools: [],
    };
    const tool: ExecutableTool = {
      descriptor: {
        name: "search_web",
        description: "Search the current public web.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        providerTool: {
          capability: webSearchProviderToolCapability,
        },
      },
      policy: {
        sourceId: "native.web",
        connectionId: "builtin-web",
        name: "search_web",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        approval: "never",
      },
      async execute() {
        throw new Error("provider-defined tool should not execute locally");
      },
    };
    const fetchTool: ExecutableTool = {
      descriptor: {
        name: "fetch_public_url",
        description: "Read a specific public web page or PDF.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
        providerTool: {
          capability: webFetchProviderToolCapability,
        },
      },
      policy: {
        sourceId: "native.web",
        connectionId: "builtin-web",
        name: "fetch_public_url",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        approval: "never",
      },
      async execute() {
        throw new Error("provider-defined tool should not execute locally");
      },
    };

    const result = await new AiSdkAgentRunner(runtime.model, {
      providerTools: runtime.providerTools,
      providerUsage: runtime.providerUsage,
    }).run({
      runId: "run-web",
      task,
      tools: [tool, fetchTool],
    });

    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]?.tools).toEqual([
      { type: "openrouter:web_search", engine: "auto" },
      { type: "openrouter:web_fetch" },
    ]);
    expect(requestBodies[0]?.max_tool_calls).toBeUndefined();
    expect(requestBodies[0]?.response_format).toBeUndefined();
    expect(result.result.body.content).toBe(
      "Current search results support the report.",
    );
    expect(result.result.sources).toEqual([
      {
        id: "https://trends.google.com/trending",
        title: "Trending Now - Google Trends",
        url: "https://trends.google.com/trending",
      },
    ]);
    expect(result.usage.costUsdMicros).toBe(1_234);
    expect(result.usage.actualCostUsdMicros).toBe(1_234);
    expect(result.usage.costSource).toBe("provider_reported");
    expect(result.usage.webSearchRequests).toBe(1);
    expect(result.usage.providerToolCalls).toBe(1);
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
