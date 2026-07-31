import { describe, expect, test } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type AgentEventPayloadV1,
  type AgentEventSink,
  type AgentEventV1,
  parseAgentEventV1,
} from "../src/agent-events.ts";
import type { Task } from "../src/contracts.ts";
import { PiAgentRunner } from "../src/pi-agent-runner.ts";
import type { ExecutableTool } from "../src/tools.ts";

const task: Task = {
  id: "task-pi",
  prompt: "Look up the daily signal and summarize it.",
  enabled: true,
  nextRunAt: new Date("2026-07-31T15:00:00.000Z"),
  catchUpPolicy: "catch_up",
  tools: [],
};

class MemoryAgentEventSink implements AgentEventSink {
  readonly events: AgentEventV1[] = [];

  async append(
    payload: AgentEventPayloadV1,
    occurredAt: Date,
  ): Promise<AgentEventV1> {
    const event = parseAgentEventV1({
      ...payload,
      schemaVersion: 1,
      eventId: `event-${this.events.length}`,
      runId: "run-pi",
      sequence: this.events.length,
      occurredAt: occurredAt.toISOString(),
    });
    this.events.push(event);
    return event;
  }
}

function createRuntime() {
  const faux = fauxProvider({
    provider: "test-provider",
    models: [
      {
        id: "test-model",
        cost: {
          input: 1,
          output: 2,
          cacheRead: 0.5,
          cacheWrite: 1.5,
        },
      },
    ],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel("test-provider", "test-model");
  if (!model) {
    throw new Error("Faux model is missing");
  }

  return {
    faux,
    runtime: {
      model,
      streamFn: models.streamSimple.bind(models),
    },
  };
}

describe("PiAgentRunner", () => {
  test("runs only curated tools and emits normalized events before projection", async () => {
    const { faux, runtime } = createRuntime();
    const contexts: Array<{ taskId: string; runId: string }> = [];
    faux.setResponses([
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toEqual([
          "lookup_signal",
        ]);
        return fauxAssistantMessage(
          fauxToolCall("lookup_signal", { topic: "daily" }, { id: "call-1" }),
          {
            stopReason: "toolUse",
            responseId: "response-1",
          },
        );
      },
      fauxAssistantMessage(
        "## Daily signal\n\nThe signal rose **12%** today.",
        {
          stopReason: "stop",
          responseId: "response-2",
        },
      ),
    ]);
    const tool: ExecutableTool = {
      descriptor: {
        name: "lookup_signal",
        description: "Read the current daily signal.",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string" },
          },
          required: ["topic"],
          additionalProperties: false,
        },
      },
      policy: {
        sourceId: "native.signal",
        connectionId: "connection-signal",
        name: "lookup_signal",
        inputSchemaHash: "test-only",
        risk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
        approval: "never",
      },
      async execute(_input, context) {
        contexts.push({
          taskId: context.taskId,
          runId: context.runId,
        });
        return {
          content: ["The daily signal is 112."],
          structuredContent: { value: 112, changePercent: 12 },
        };
      },
    };
    const sink = new MemoryAgentEventSink();
    const result = await new PiAgentRunner(runtime).run({
      runId: "run-pi",
      task,
      tools: [tool],
      eventSink: sink,
    });

    expect(contexts).toEqual([{ taskId: "task-pi", runId: "run-pi" }]);
    expect(result.result).toMatchObject({
      schemaVersion: 1,
      summary: "Daily signal",
      body: {
        format: "markdown",
        content: "## Daily signal\n\nThe signal rose **12%** today.",
      },
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      toolName: "lookup_signal",
      input: { topic: "daily" },
      status: "succeeded",
      outputSummary: "The daily signal is 112.",
    });
    expect(sink.events.map((event) => event.type)).toEqual([
      "lifecycle",
      "message",
      "tool_call",
      "policy_decision",
      "tool_result",
      "usage",
      "message",
      "usage",
      "lifecycle",
    ]);
    expect(sink.events.at(-1)).toMatchObject({
      type: "lifecycle",
      phase: "completed",
    });
    expect(sink.events.filter((event) => event.type === "usage")).toHaveLength(
      2,
    );
  });

  test("normalizes provider failures into failed lifecycle events", async () => {
    const { faux, runtime } = createRuntime();
    faux.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "provider unavailable",
      }),
    ]);
    const sink = new MemoryAgentEventSink();

    await expect(
      new PiAgentRunner(runtime).run({
        runId: "run-pi",
        task,
        tools: [],
        eventSink: sink,
      }),
    ).rejects.toThrow("provider unavailable");
    expect(sink.events.at(-1)).toMatchObject({
      type: "lifecycle",
      phase: "failed",
      message: "provider unavailable",
    });
  });

  test("honors cancellation without starting a model request", async () => {
    const { faux, runtime } = createRuntime();
    const controller = new AbortController();
    controller.abort();
    const sink = new MemoryAgentEventSink();

    await expect(
      new PiAgentRunner(runtime).run({
        runId: "run-pi",
        task,
        tools: [],
        eventSink: sink,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(faux.state.callCount).toBe(0);
    expect(sink.events.at(-1)).toMatchObject({
      type: "lifecycle",
      phase: "cancelled",
    });
  });
});
