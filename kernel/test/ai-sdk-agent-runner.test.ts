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

  test("continues beyond the former six-step runner boundary", async () => {
    let executions = 0;
    const model = new MockLanguageModelV4({
      doStream: [
        ...Array.from({ length: 7 }, (_, index) => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "tool-call" as const,
                toolCallId: `lookup-${index + 1}`,
                toolName: "lookup",
                input: JSON.stringify({ index }),
                dynamic: true,
              },
              {
                type: "finish" as const,
                finishReason: {
                  unified: "tool-calls" as const,
                  raw: "tool_calls",
                },
                usage,
              },
            ],
          }),
        })),
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-final" },
              {
                type: "text-delta",
                id: "text-final",
                delta: "Finished after all seven lookups.",
              },
              { type: "text-end", id: "text-final" },
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
    const lookup: ExecutableTool = {
      descriptor: {
        name: "lookup",
        description: "Look up another fact.",
        inputSchema: { type: "object", properties: {} },
      },
      policy: {
        sourceId: "native.lookup",
        connectionId: "lookup",
        name: "lookup",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
        approval: "never",
      },
      async execute() {
        executions += 1;
        return { content: [`result ${executions}`] };
      },
    };

    const result = await new AiSdkAgentRunner(model).run({
      runId: "run-long-loop",
      task,
      tools: [lookup],
    });

    expect(model.doStreamCalls).toHaveLength(8);
    expect(executions).toBe(7);
    expect(result.result.body.content).toBe(
      "Finished after all seven lookups.",
    );
  });

  test("does not ration parallel calls with legacy pinned-tool budgets", async () => {
    let executions = 0;
    const events: AgentEventPayloadV1[] = [];
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              ...Array.from({ length: 3 }, (_, index) => ({
                type: "tool-call" as const,
                toolCallId: `search-${index + 1}`,
                toolName: "search_web",
                input: JSON.stringify({ query: `query ${index + 1}` }),
                dynamic: true,
              })),
              {
                type: "finish",
                finishReason: {
                  unified: "tool-calls" as const,
                  raw: "tool_calls",
                },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-complete" },
              {
                type: "text-delta",
                id: "text-complete",
                delta:
                  "All three searches completed, and the results support the report.",
              },
              { type: "text-end", id: "text-complete" },
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
    const search: ExecutableTool = {
      descriptor: {
        name: "search_web",
        description: "Search the public web.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
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
        executions += 1;
        return { content: [{ results: [] }] };
      },
    };

    const result = await new AiSdkAgentRunner(model).run({
      runId: "run-tool-budget",
      task: {
        ...task,
        id: "task-tool-budget",
      },
      tools: [search],
      eventSink: {
        async append(payload) {
          events.push(payload);
          return {} as AgentEventV1;
        },
      },
    });

    expect(executions).toBe(3);
    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls.map(({ status }) => status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(
      events.some(
        (event) =>
          event.type === "policy_decision" &&
          event.decision === "denied" &&
          event.ruleId === "tool-call-budget-exhausted",
      ),
    ).toBe(false);
  });

  test("does not reject repeated calls with a host heuristic", async () => {
    let executions = 0;
    const events: AgentEventPayloadV1[] = [];
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "repeat-1",
                toolName: "lookup",
                input: '{"query":"same","limit":5}',
                dynamic: true,
              },
              {
                type: "tool-call",
                toolCallId: "repeat-2",
                toolName: "lookup",
                input: '{"limit":5,"query":"same"}',
                dynamic: true,
              },
              {
                type: "tool-call",
                toolCallId: "repeat-3",
                toolName: "lookup",
                input: '{"query":"same","limit":5}',
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: {
                  unified: "tool-calls" as const,
                  raw: "tool_calls",
                },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-repeated-call" },
              {
                type: "text-delta",
                id: "text-repeated-call",
                delta:
                  "Springroll stopped a repeated lookup. Two attempts completed; the third did not run.",
              },
              { type: "text-end", id: "text-repeated-call" },
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
    const lookup: ExecutableTool = {
      descriptor: {
        name: "lookup",
        description: "Look up a value.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
          },
          required: ["query", "limit"],
        },
      },
      policy: {
        sourceId: "native.lookup",
        connectionId: "lookup",
        name: "lookup",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
        approval: "never",
      },
      async execute() {
        executions += 1;
        return { content: [`result ${executions}`] };
      },
    };

    const result = await new AiSdkAgentRunner(model).run({
      runId: "run-repeated-call",
      task,
      tools: [lookup],
      eventSink: {
        async append(payload) {
          events.push(payload);
          return {} as AgentEventV1;
        },
      },
    });

    expect(executions).toBe(3);
    expect(result.toolCalls).toHaveLength(3);
    expect(
      events.some(
        (event) =>
          event.type === "policy_decision" &&
          event.decision === "denied" &&
          event.ruleId === "repeated-tool-call",
      ),
    ).toBe(false);
  });

  test("forces synthesis after the cumulative input-token budget", async () => {
    let executions = 0;
    const model = new MockLanguageModelV4({
      doStream: [
        ...Array.from({ length: 2 }, (_, index) => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "tool-call" as const,
                toolCallId: `input-budget-${index + 1}`,
                toolName: "lookup",
                input: JSON.stringify({ index }),
                dynamic: true,
              },
              {
                type: "finish" as const,
                finishReason: {
                  unified: "tool-calls" as const,
                  raw: "tool_calls",
                },
                usage,
              },
            ],
          }),
        })),
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-input-budget" },
              {
                type: "text-delta",
                id: "text-input-budget",
                delta:
                  "The cumulative input budget was reached after two lookups. No additional research was attempted.",
              },
              { type: "text-end", id: "text-input-budget" },
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
    const lookup: ExecutableTool = {
      descriptor: {
        name: "lookup",
        description: "Look up a distinct value.",
        inputSchema: {
          type: "object",
          properties: { index: { type: "integer" } },
          required: ["index"],
        },
      },
      policy: {
        sourceId: "native.lookup",
        connectionId: "lookup",
        name: "lookup",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
        approval: "never",
      },
      async execute() {
        executions += 1;
        return { content: [`result ${executions}`] };
      },
    };

    const result = await new AiSdkAgentRunner(model, {
      maxCumulativeInputTokens: 20,
    }).run({
      runId: "run-input-budget",
      task,
      tools: [lookup],
    });

    expect(executions).toBe(2);
    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doStreamCalls[2]?.toolChoice).toEqual({ type: "none" });
    expect(model.doStreamCalls[2]?.tools).toBeUndefined();
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain(
      "reached an emergency context boundary",
    );
    expect(result.result.body.content).toContain("after two lookups");
  });

  test("forces synthesis after the active-execution time budget", async () => {
    let clockMs = 0;
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "slow-lookup",
                toolName: "lookup",
                input: '{"query":"slow"}',
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: {
                  unified: "tool-calls",
                  raw: "tool_calls",
                },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-elapsed-budget" },
              {
                type: "text-delta",
                id: "text-elapsed-budget",
                delta:
                  "The active-execution time budget was reached after one lookup. Further work remains incomplete.",
              },
              { type: "text-end", id: "text-elapsed-budget" },
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
    const lookup: ExecutableTool = {
      descriptor: {
        name: "lookup",
        description: "Perform a slow lookup.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      policy: {
        sourceId: "native.lookup",
        connectionId: "lookup",
        name: "lookup",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
        approval: "never",
      },
      async execute() {
        clockMs = 1_000;
        return { content: ["slow result"] };
      },
    };

    const result = await new AiSdkAgentRunner(model, {
      maxActiveRunDurationMs: 500,
      now: () => new Date(clockMs),
    }).run({
      runId: "run-elapsed-budget",
      task,
      tools: [lookup],
    });

    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[1]?.toolChoice).toEqual({ type: "none" });
    expect(model.doStreamCalls[1]?.tools).toBeUndefined();
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      "reached its emergency execution-time boundary",
    );
    expect(result.result.body.content).toContain("remains incomplete");
  });

  test("does not serialize a completed run as an approval continuation", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "large-result",
                toolName: "read_large_source",
                input: "{}",
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
              { type: "text-start", id: "text-large-source" },
              {
                type: "text-delta",
                id: "text-large-source",
                delta: "The large source was processed.",
              },
              { type: "text-end", id: "text-large-source" },
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
    const readLargeSource: ExecutableTool = {
      descriptor: {
        name: "read_large_source",
        description: "Read a large source.",
        inputSchema: { type: "object", properties: {} },
      },
      policy: {
        sourceId: "native.large-source",
        connectionId: "large-source",
        name: "read_large_source",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
        approval: "never",
      },
      async execute() {
        return { content: ["x".repeat(520_000)] };
      },
    };

    const result = await new AiSdkAgentRunner(model).run({
      runId: "run-large-completed",
      task,
      tools: [readLargeSource],
    });

    expect(result.result.body.content).toBe("The large source was processed.");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt).length).toBeLessThan(
      60_000,
    );
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      "Tool result truncated from",
    );
  });

  test("compacts older tool results into a bounded evidence ledger", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        ...Array.from({ length: 3 }, (_, index) => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "tool-call" as const,
                toolCallId: `large-evidence-${index}`,
                toolName: "read_source",
                input: JSON.stringify({ source: index }),
                dynamic: true,
              },
              {
                type: "finish" as const,
                finishReason: {
                  unified: "tool-calls" as const,
                  raw: "tool_calls",
                },
                usage,
              },
            ],
          }),
        })),
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-compacted-evidence" },
              {
                type: "text-delta",
                id: "text-compacted-evidence",
                delta: "The three sources were compared.",
              },
              { type: "text-end", id: "text-compacted-evidence" },
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
    const readSource: ExecutableTool = {
      descriptor: {
        name: "read_source",
        description: "Read one evidence source.",
        inputSchema: {
          type: "object",
          properties: { source: { type: "integer" } },
          required: ["source"],
        },
      },
      policy: {
        sourceId: "native.source",
        connectionId: "source",
        name: "read_source",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
        approval: "never",
      },
      async execute(input) {
        return { content: [`source ${input.source}: ${"x".repeat(45_000)}`] };
      },
    };

    const result = await new AiSdkAgentRunner(model).run({
      runId: "run-compacted-evidence",
      task,
      tools: [readSource],
    });

    const finalPrompt = JSON.stringify(model.doStreamCalls[3]?.prompt);
    expect(finalPrompt).toContain("Evidence ledger: older read_source result");
    expect(finalPrompt.length).toBeLessThan(110_000);
    expect(result.result.body.content).toBe("The three sources were compared.");
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
