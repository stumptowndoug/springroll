import { describe, expect, test } from "bun:test";
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
import { PiAgentRunner } from "../src/pi-agent-runner.ts";
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

  test("passes agent-controlled web server tools through the AI SDK", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.values.set("openrouter-default", "sk-or-v1-test-secret");
    let requestBody: Record<string, unknown> | undefined;
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          id: "generation-web",
          model: defaultOpenRouterModelId,
          provider: "OpenAI",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Current search results support the report.",
                annotations: [
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
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 6,
            total_tokens: 16,
            cost: 0.001234,
            server_tool_use: {
              web_search_requests: 1,
            },
          },
        });
      },
    });
    const runtime = await connection.loadAgentRuntime("openrouter-default");
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
          provider: "openrouter",
          name: "web_search",
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
          provider: "openrouter",
          name: "web_fetch",
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

    expect(requestBody?.tools).toEqual([
      { type: "openrouter:web_search" },
      { type: "openrouter:web_fetch" },
    ]);
    expect(requestBody?.max_tool_calls).toBe(5);
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

  test("runs an ordinary OpenRouter task through Pi with injected credentials", async () => {
    const credentials = new MemoryCredentialStore();
    credentials.values.set("openrouter-default", "sk-or-v1-pi-secret");
    let authorization: string | null = null;
    let requestBody: Record<string, unknown> | undefined;
    const connection = new OpenRouterModelConnection(credentials, {
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const chunks = [
          {
            id: "generation-pi",
            model: defaultOpenRouterModelId,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "generation-pi",
            model: defaultOpenRouterModelId,
            choices: [
              {
                index: 0,
                delta: { content: "Pi completed the scheduled task." },
                finish_reason: null,
              },
            ],
          },
          {
            id: "generation-pi",
            model: defaultOpenRouterModelId,
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
    const runtime = await connection.loadPiAgentRuntime("openrouter-default");
    const task: Task = {
      id: "task-pi-openrouter",
      prompt: "Complete this scheduled task.",
      enabled: true,
      nextRunAt: new Date("2026-07-31T15:00:00.000Z"),
      catchUpPolicy: "skip_to_next",
      tools: [],
    };

    const result = await new PiAgentRunner(runtime).run({
      runId: "run-pi-openrouter",
      task,
      tools: [],
    });

    expect(String(authorization)).toBe("Bearer sk-or-v1-pi-secret");
    expect(requestBody).toMatchObject({
      model: defaultOpenRouterModelId,
      stream: true,
    });
    expect(result.result.body.content).toBe("Pi completed the scheduled task.");
    expect(result.usage).toMatchObject({
      provider: "openrouter",
      modelId: defaultOpenRouterModelId,
      inputTokens: 10,
      outputTokens: 6,
      totalTokens: 16,
      costUsdMicros: 35,
    });
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
