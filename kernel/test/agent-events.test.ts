import { describe, expect, test } from "bun:test";
import { parseAgentEventV1 } from "../src/agent-events.ts";

describe("AgentEventV1", () => {
  test("normalizes provider-neutral source and usage events", () => {
    const identity = {
      schemaVersion: 1 as const,
      runId: "run-1",
      occurredAt: "2026-07-30T15:00:00.000Z",
    };

    expect(
      parseAgentEventV1({
        ...identity,
        eventId: "event-source",
        sequence: 3,
        type: "source",
        sourceId: "source-1",
        title: "Primary report",
        url: "https://example.com/report",
        toolCallId: "call-search",
        providerMetadata: {
          providerRequestId: "request-1",
        },
      }),
    ).toMatchObject({
      type: "source",
      sourceId: "source-1",
      url: "https://example.com/report",
    });

    expect(
      parseAgentEventV1({
        ...identity,
        eventId: "event-usage",
        sequence: 4,
        type: "usage",
        modelCallId: "model-call-1",
        provider: "openrouter",
        modelId: "provider/model",
        billing: "metered",
        inputTokens: 120,
        outputTokens: 40,
        reasoningTokens: 10,
        cachedInputTokens: 20,
        totalTokens: 160,
        costUsdMicros: 240,
      }),
    ).toMatchObject({
      type: "usage",
      billing: "metered",
      totalTokens: 160,
      costUsdMicros: 240,
    });
  });

  test("rejects invalid event identities and provider-specific event types", () => {
    expect(() =>
      parseAgentEventV1({
        schemaVersion: 1,
        eventId: "event-1",
        runId: "run-1",
        sequence: -1,
        occurredAt: "not-a-date",
        type: "openrouter.web_search",
      }),
    ).toThrow();
  });
});
