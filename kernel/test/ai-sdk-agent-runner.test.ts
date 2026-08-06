import { describe, expect, test } from "bun:test";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AgentEventPayloadV1, AgentEventV1 } from "../src/agent-events.ts";
import {
  AgentRunApprovalRequiredError,
  AiSdkAgentRunner,
} from "../src/ai-sdk-agent-runner.ts";
import type { Task } from "../src/contracts.ts";
import { webSearchProviderToolCapability } from "../src/provider-tools.ts";
import type { ExecutableTool } from "../src/tools.ts";

const usage = {
  inputTokens: {
    total: 12,
    noCache: 10,
    cacheRead: 2,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 8,
    text: 6,
    reasoning: 2,
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
    const events: AgentEventPayloadV1[] = [];
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tool-call-1",
                toolName: "get_hacker_news_top_stories",
                input: '{"limit":2}',
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              {
                type: "text-delta",
                id: "text-1",
                delta:
                  "# Today on Hacker News\n\nLocal-first software led the discussion.",
              },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage,
              },
            ],
          }),
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
      pricing: {
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 8,
      },
      catalogRevision: "catalog-v1",
      providerUsage: {
        read: () => ({ webSearchRequests: 2 }),
      },
    });

    const result = await runner.run({
      runId: "run-hn",
      task,
      tools: [tool],
      eventSink: {
        async append(payload, occurredAt) {
          events.push(payload);
          return {
            ...payload,
            schemaVersion: 1,
            eventId: `event-${events.length}`,
            runId: "run-hn",
            sequence: events.length - 1,
            occurredAt: occurredAt.toISOString(),
          } as AgentEventV1;
        },
      },
    });

    expect(model.doStreamCalls).toHaveLength(2);
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
        billing: "metered",
        inputTokens: 24,
        outputTokens: 16,
        reasoningTokens: 4,
        cachedInputTokens: 4,
        totalTokens: 40,
        costUsdMicros: 176,
        estimatedCostUsdMicros: 176,
        costSource: "catalog_estimate",
        webSearchRequests: 2,
      },
      startedAt,
      finishedAt,
    });
    expect(
      events.map((event) =>
        event.type === "lifecycle"
          ? `${event.type}:${event.phase}`
          : event.type,
      ),
    ).toEqual([
      "model_selection",
      "lifecycle:started",
      "model_turn",
      "model_turn",
      "policy_decision",
      "tool_call",
      "tool_result",
      "usage",
      "model_turn",
      "model_turn",
      "usage",
      "message",
      "usage",
      "lifecycle:completed",
    ]);
    expect(events[0]).toMatchObject({
      type: "model_selection",
      provider: "mock-provider",
      modelId: "mock-model-id",
      billing: "metered",
      catalogRevision: "catalog-v1",
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 8,
    });
    expect(events.filter((event) => event.type === "usage")).toMatchObject([
      {
        type: "usage",
        provider: "mock-provider",
        modelId: "mock-model-id",
        billing: "metered",
        inputTokens: 12,
        outputTokens: 8,
        cachedInputTokens: 2,
        reasoningTokens: 2,
        totalTokens: 20,
        estimatedCostUsdMicros: 88,
        costSource: "catalog_estimate",
      },
      {
        type: "usage",
        provider: "mock-provider",
        modelId: "mock-model-id",
        billing: "metered",
        inputTokens: 12,
        outputTokens: 8,
        cachedInputTokens: 2,
        reasoningTokens: 2,
        totalTokens: 20,
        estimatedCostUsdMicros: 88,
        costSource: "catalog_estimate",
      },
      {
        type: "usage",
        provider: "mock-provider",
        modelId: "mock-model-id",
        billing: "metered",
        webSearchRequests: 2,
      },
    ]);
  });

  test("pauses and resumes the exact tool call that requires approval", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "publish-1",
                toolName: "publish_digest",
                input: '{"channel":"daily"}',
                dynamic: true,
                providerMetadata: { mock: { private: "remove-me" } },
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-approved" },
              {
                type: "text-delta",
                id: "text-approved",
                delta: "The digest was published.",
              },
              { type: "text-end", id: "text-approved" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage,
              },
            ],
          }),
        },
      ],
    });
    const calls: unknown[] = [];
    const transitions: string[] = [];
    const tool: ExecutableTool = {
      descriptor: {
        name: "publish_digest",
        description: "Publish a digest.",
        inputSchema: {
          type: "object",
          properties: { channel: { type: "string" } },
          required: ["channel"],
        },
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
      async execute(input) {
        calls.push(input);
        return { content: ["published"] };
      },
    };
    const runner = new AiSdkAgentRunner(model);

    let paused: AgentRunApprovalRequiredError | undefined;
    try {
      await runner.run({ runId: "run-hn", task, tools: [tool] });
    } catch (error) {
      if (error instanceof AgentRunApprovalRequiredError) paused = error;
      else throw error;
    }
    expect(paused?.approvals).toMatchObject([
      {
        toolCallId: "publish-1",
        toolName: "publish_digest",
        input: { channel: "daily" },
        riskEffect: "write",
      },
    ]);
    expect(JSON.stringify(paused?.messages)).not.toContain("remove-me");
    expect(calls).toEqual([]);
    const approval = paused?.approvals[0];
    if (!paused || !approval) throw new Error("Expected a paused run");

    const result = await runner.run({
      runId: "run-hn",
      task,
      tools: [tool],
      continuation: {
        messages: paused.messages,
        startedAt: new Date("2026-08-06T12:00:00.000Z"),
        approvals: [{ id: approval.id, approved: true }],
      },
      approvalExecution: {
        starting: (toolCallId) => {
          transitions.push(`start:${toolCallId}`);
        },
        finished: (toolCallId, status) => {
          transitions.push(`${status}:${toolCallId}`);
        },
      },
    });

    expect(result.result.body.content).toBe("The digest was published.");
    expect(calls).toEqual([{ channel: "daily" }]);
    expect(transitions).toEqual(["start:publish-1", "succeeded:publish-1"]);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  test("runs a provider-neutral capability through its host fallback", async () => {
    const events: AgentEventPayloadV1[] = [];
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "search-1",
                toolName: "search_web",
                input: '{"query":"current movie times"}',
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-web" },
              {
                type: "text-delta",
                id: "text-web",
                delta: "The current listings are ready.",
              },
              { type: "text-end", id: "text-web" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage,
              },
            ],
          }),
        },
      ],
    });
    const tool: ExecutableTool = {
      descriptor: {
        name: "search_web",
        description: "Search the current public web.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        providerTool: {
          capability: webSearchProviderToolCapability,
          fallback: "host",
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
        calls += 1;
        return { content: [{ results: [] }] };
      },
    };

    const result = await new AiSdkAgentRunner(model).run({
      runId: "run-web",
      task: { ...task, id: "task-web", prompt: "Find current movie times." },
      tools: [tool],
      eventSink: {
        async append(payload) {
          events.push(payload);
          return {} as AgentEventV1;
        },
      },
    });

    expect(calls).toBe(1);
    expect(result.toolCalls).toMatchObject([
      { toolName: "search_web", status: "succeeded" },
    ]);
    expect(events.map((event) => event.type)).toContain("tool_call");
    expect(events.map((event) => event.type)).toContain("tool_result");
  });

  test("honors a zero-retry model policy", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
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

    await expect(
      runner.run({ runId: "run-hn", task, tools: [] }),
    ).rejects.toThrow("provider temporarily unavailable");
    expect(model.doStreamCalls).toHaveLength(1);
  });

  test("records provider retries and model-turn milestones without deltas", async () => {
    const events: AgentEventPayloadV1[] = [];
    let attempts = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new APICallError({
            message: "provider temporarily unavailable",
            url: "https://provider.example.test/generate",
            requestBodyValues: {},
            statusCode: 503,
            responseHeaders: { "retry-after-ms": "0" },
            isRetryable: true,
          });
        }

        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-retry" },
              {
                type: "text-delta",
                id: "text-retry",
                delta: "Recovered after retry.",
              },
              { type: "text-end", id: "text-retry" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage,
              },
            ],
          }),
        };
      },
    });
    const runner = new AiSdkAgentRunner(model, { maxRetries: 1 });

    const result = await runner.run({
      runId: "run-retry",
      task,
      tools: [],
      eventSink: {
        async append(payload) {
          events.push(payload);
          return {} as AgentEventV1;
        },
      },
    });

    expect(result.result.body.content).toBe("Recovered after retry.");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(events.filter((event) => event.type === "model_retry")).toEqual([
      {
        type: "model_retry",
        turnId: expect.any(String),
        step: 0,
        attempt: 2,
        provider: "mock-provider",
        modelId: "mock-model-id",
      },
    ]);
    expect(
      events
        .filter((event) => event.type === "model_turn")
        .map((event) => (event.type === "model_turn" ? event.phase : null)),
    ).toEqual(["started", "completed"]);
    expect(events.some((event) => event.type === "message")).toBe(true);
    expect(
      events.some((event) =>
        ["text-delta", "reasoning", "reasoning-delta"].includes(event.type),
      ),
    ).toBe(false);
  });
});
