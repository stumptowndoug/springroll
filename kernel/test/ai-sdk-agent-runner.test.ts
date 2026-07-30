import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AiSdkAgentRunner } from "../src/ai-sdk-agent-runner.ts";
import type { Task } from "../src/contracts.ts";
import type { ExecutableTool } from "../src/tools.ts";

const usage = {
  inputTokens: {
    total: 12,
    noCache: 12,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 8,
    text: 8,
    reasoning: 0,
  },
};

const task: Task = {
  id: "task-hn",
  prompt: "Summarize the top two Hacker News stories.",
  enabled: true,
  nextRunAt: new Date("2026-07-31T15:00:00.000Z"),
  catchUpPolicy: "catch_up",
  tools: [],
};

describe("AiSdkAgentRunner", () => {
  test("executes a dynamic kernel tool and returns readable final text", async () => {
    const calls: unknown[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-call-1",
              toolName: "get_hacker_news_top_stories",
              input: '{"limit":2}',
              dynamic: true,
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage,
          warnings: [],
        },
        {
          content: [
            {
              type: "text",
              text: "# Today on Hacker News\n\nLocal-first software led the discussion.",
            },
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    const tool: ExecutableTool = {
      descriptor: {
        name: "get_hacker_news_top_stories",
        description: "Get the top Hacker News stories.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer" },
          },
          required: ["limit"],
          additionalProperties: false,
        },
      },
      policy: {
        sourceId: "native.hacker-news",
        connectionId: "connection-hn",
        name: "get_hacker_news_top_stories",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        approval: "never",
      },
      async execute(input, context) {
        calls.push({ input, context });
        return {
          content: ["1. A useful story"],
          structuredContent: {
            stories: [{ id: 1, title: "A useful story" }],
          },
        };
      },
    };
    const startedAt = new Date("2026-07-31T15:00:00.000Z");
    const finishedAt = new Date("2026-07-31T15:00:01.000Z");
    let isFirstClockRead = true;
    const runner = new AiSdkAgentRunner(model, {
      now: () => {
        if (isFirstClockRead) {
          isFirstClockRead = false;
          return startedAt;
        }

        return finishedAt;
      },
      createRunId: () => "run-hn",
      pricing: {
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 8,
      },
    });

    const result = await runner.run({ task, tools: [tool] });

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(calls).toEqual([
      {
        input: { limit: 2 },
        context: {
          taskId: "task-hn",
          runId: "run-hn",
        },
      },
    ]);
    expect(result).toEqual({
      result: {
        schemaVersion: 1,
        disposition: "informational",
        summary: "Today on Hacker News",
        body: {
          format: "markdown",
          content:
            "# Today on Hacker News\n\nLocal-first software led the discussion.",
        },
        sources: [],
        artifacts: [],
        proposals: [],
        notices: [],
      },
      toolCalls: [
        {
          toolName: "get_hacker_news_top_stories",
          input: { limit: 2 },
          status: "succeeded",
          startedAt: finishedAt,
          finishedAt,
          outputSummary: "1. A useful story",
        },
      ],
      usage: {
        provider: "mock-provider",
        modelId: "mock-model-id",
        inputTokens: 24,
        outputTokens: 16,
        totalTokens: 40,
        costUsdMicros: 176,
      },
      startedAt,
      finishedAt,
    });
  });

  test("does not execute a tool that requires approval", async () => {
    const model = new MockLanguageModelV4();
    const tool: ExecutableTool = {
      descriptor: {
        name: "publish_digest",
        description: "Publish a digest.",
        inputSchema: { type: "object" },
      },
      policy: {
        sourceId: "native.publisher",
        connectionId: "connection-publisher",
        name: "publish_digest",
        inputSchemaHash: "test-only",
        risk: {
          effect: "write",
          openWorld: true,
          idempotent: false,
        },
        approval: "before_call",
      },
      async execute() {
        throw new Error("tool should not execute");
      },
    };
    const runner = new AiSdkAgentRunner(model);

    await expect(runner.run({ task, tools: [tool] })).rejects.toThrow(
      "requires approval",
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test("honors a zero-retry model policy", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "provider temporarily unavailable",
          url: "https://provider.example.test/generate",
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      },
    });
    const runner = new AiSdkAgentRunner(model, { maxRetries: 0 });

    await expect(runner.run({ task, tools: [] })).rejects.toThrow(
      "provider temporarily unavailable",
    );
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
