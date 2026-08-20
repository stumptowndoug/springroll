import { describe, expect, test } from "bun:test";
import {
  chatTurnUsage,
  formatDurationMs,
  formatUsdMicros,
  runProgressLabel,
  runTurnActivity,
  runTurnUsage,
  type TurnStepInput,
  turnActivity,
  turnActivityTitle,
  turnLivePreview,
  turnStepWeight,
  turnUsageDetails,
  turnUsageDistillerDetails,
  turnUsageImageDetails,
  turnUsageSummary,
} from "../src/client/turn-activity.ts";
import type {
  ChatTurnDto,
  ChatUsageDto,
  RunDetailDto,
  RunEventDto,
} from "../src/shared.ts";

function step(
  overrides: Partial<TurnStepInput> & { key: string },
): TurnStepInput {
  return {
    label: "Inspect connections",
    running: false,
    failed: false,
    signature: "tool-list_connections:{}",
    ...overrides,
  };
}

describe("turnActivity", () => {
  test("counts calls, failures, and the agent repeating itself", () => {
    const activity = turnActivity([
      step({ key: "1", signature: "list:{}" }),
      step({ key: "2", signature: "list:{}" }),
      step({ key: "3", signature: 'search:{"q":"a"}' }),
      step({ key: "4", signature: "list:{}" }),
      step({ key: "5", signature: "usage:{}", failed: true }),
    ]);

    expect(activity.tools).toBe(5);
    expect(activity.errors).toBe(1);
    expect(activity.repeats).toBe(2);
    expect(activity.steps.map((entry) => entry.repeat)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(turnActivityTitle(activity)).toBe(
      "5 tool calls · 1 failed · 2 repeated",
    );
  });

  test("stays quiet about timings the surface does not record", () => {
    const activity = turnActivity([
      step({ key: "1", signature: "list:{}" }),
      step({ key: "2", signature: "search:{}" }),
    ]);
    expect(activity.longestMs).toBeUndefined();
    expect(
      activity.steps.map((entry) => turnStepWeight(entry, activity.longestMs)),
    ).toEqual([undefined, undefined]);
    expect(turnActivityTitle(activity)).toBe("2 tool calls");
  });

  test("weights each tick against the slowest step when timings exist", () => {
    const activity = turnActivity([
      step({ key: "1", durationMs: 400 }),
      step({ key: "2", durationMs: 8_000, signature: "fetch:{}" }),
      step({ key: "3", durationMs: 4_000, signature: "sql:{}" }),
    ]);

    expect(activity.longestMs).toBe(8_000);
    expect(
      activity.steps.map((entry) => turnStepWeight(entry, activity.longestMs)),
    ).toEqual([0.05, 1, 0.5]);
  });

  test("never calls a step a repeat without a signature to go on", () => {
    const activity = turnActivity([
      { key: "1", label: "Using Run Sql", running: false, failed: false },
      { key: "2", label: "Using Run Sql", running: false, failed: false },
    ]);
    expect(activity.repeats).toBe(0);
    expect(activity.steps.every((entry) => !entry.repeat)).toBe(true);
  });

  test("keeps the caller's own step fields", () => {
    const activity = turnActivity([
      { ...step({ key: "1" }), issues: [{ path: "a", message: "b" }] },
    ]);
    expect(activity.steps[0]?.issues).toEqual([{ path: "a", message: "b" }]);
  });
});

describe("formatDurationMs", () => {
  test("reads as seconds under a minute and mm ss above it", () => {
    expect(formatDurationMs(0)).toBe("0s");
    expect(formatDurationMs(36_400)).toBe("36s");
    expect(formatDurationMs(124_000)).toBe("2m 04s");
  });
});

describe("runTurnActivity", () => {
  test("correctly reconciles parallel tool call and result events without leaving steps in running state", () => {
    const events: RunEventDto[] = [
      // Turn 1 starts 3 tool calls in parallel
      {
        id: "call-1",
        sequence: 1,
        kind: "tool",
        title: "Using Tool Alpha",
        occurredAt: "2026-08-17T08:00:00.000Z",
      },
      {
        id: "call-2",
        sequence: 2,
        kind: "tool",
        title: "Using Tool Beta",
        occurredAt: "2026-08-17T08:00:00.100Z",
      },
      {
        id: "call-3",
        sequence: 3,
        kind: "tool",
        title: "Using Tool Gamma",
        occurredAt: "2026-08-17T08:00:00.200Z",
      },
      // Results complete in parallel
      {
        id: "res-1",
        sequence: 4,
        kind: "tool",
        title: "Tool call finished",
        detail: "1 row",
        tone: "success",
        occurredAt: "2026-08-17T08:00:01.000Z",
      },
      {
        id: "res-2",
        sequence: 5,
        kind: "tool",
        title: "Tool call finished",
        detail: "10 rows",
        tone: "success",
        occurredAt: "2026-08-17T08:00:02.000Z",
      },
      {
        id: "res-3",
        sequence: 6,
        kind: "tool",
        title: "Tool call finished",
        detail: "connection refused",
        tone: "error",
        occurredAt: "2026-08-17T08:00:03.000Z",
      },
    ];

    const activity = runTurnActivity(events, false);
    expect(activity.tools).toBe(3);
    expect(activity.errors).toBe(1);
    // All 3 steps must be completed (running = false)
    expect(activity.steps.map((s) => s.running)).toEqual([false, false, false]);
    expect(activity.steps.map((s) => s.failed)).toEqual([false, false, true]);
    expect(activity.steps.map((s) => s.durationMs)).toEqual([1000, 1900, 2800]);
    expect(activity.steps.map((s) => s.result)).toEqual([
      { text: "1 row", tone: "neutral" },
      { text: "10 rows", tone: "neutral" },
      { text: "connection refused", tone: "danger" },
    ]);
  });

  test("compacts stored prose excerpts so run rows match chat", () => {
    const excerpt = "x".repeat(234);
    const events: RunEventDto[] = [
      {
        id: "call-1",
        sequence: 1,
        kind: "tool",
        title: "Search web",
        detail: "Germany top news headlines today",
        occurredAt: "2026-08-17T08:00:00.000Z",
      },
      {
        id: "res-1",
        sequence: 2,
        kind: "tool",
        title: "Tool call finished",
        detail: excerpt,
        tone: "success",
        occurredAt: "2026-08-17T08:00:02.000Z",
      },
    ];
    expect(runTurnActivity(events, false).steps[0]?.result).toEqual({
      text: "234 characters",
      tone: "neutral",
    });
  });

  test("marks in-flight tools as running when run is active, and clears them when run completes", () => {
    const events: RunEventDto[] = [
      {
        id: "call-1",
        sequence: 1,
        kind: "tool",
        title: "Using Tool Alpha",
        occurredAt: "2026-08-17T08:00:00.000Z",
      },
    ];

    const activeActivity = runTurnActivity(events, true);
    expect(activeActivity.steps[0]?.running).toBe(true);

    const completedActivity = runTurnActivity(events, false);
    expect(completedActivity.steps[0]?.running).toBe(false);
  });
});

describe("runProgressLabel", () => {
  test("narrates the in-flight tool, then Writing, then Thinking", () => {
    const running: RunEventDto[] = [
      {
        id: "call-1",
        sequence: 1,
        kind: "tool",
        title: "Neon · Run sql",
        toolName: "run_sql",
        occurredAt: "2026-08-17T08:00:00.000Z",
      },
    ];
    expect(runProgressLabel(running, runTurnActivity(running, true))).toBe(
      "Querying Neon",
    );

    const writing: RunEventDto[] = [
      ...running,
      {
        id: "res-1",
        sequence: 2,
        kind: "tool",
        title: "Tool call finished",
        detail: "1 row",
        tone: "success",
        occurredAt: "2026-08-17T08:00:01.000Z",
      },
      {
        id: "out-1",
        sequence: 3,
        kind: "output",
        title: "Prepared the response",
        occurredAt: "2026-08-17T08:00:02.000Z",
      },
    ];
    expect(runProgressLabel(writing, runTurnActivity(writing, true))).toBe(
      "Writing",
    );
    expect(runProgressLabel([], runTurnActivity([], true))).toBe("Thinking");
  });
});

describe("turnLivePreview", () => {
  test("keeps a verb-only start, then appends the current tool detail", () => {
    expect(turnLivePreview(undefined)).toBe("Thinking");
    expect(turnLivePreview("Querying Neon")).toBe("Querying Neon");
    expect(
      turnLivePreview(
        "Querying Neon",
        "SELECT date, amount FROM invoices WHERE status = 'open'",
      ),
    ).toBe(
      "Querying Neon · SELECT date, amount FROM invoices WHERE status = 'open'",
    );
  });
});

describe("TurnUsage", () => {
  test("collapses to duration, tokens, and cost; expands the breakdown", () => {
    const usage = {
      durationMs: 24_000,
      totalTokens: 1234,
      inputTokens: 800,
      outputTokens: 400,
      cachedInputTokens: 12,
      reasoningTokens: 80,
      webSearchRequests: 2,
      costUsdMicros: 4_200,
      costEstimated: true,
    };
    expect(turnUsageSummary(usage)).toEqual([
      "24s",
      "1,234 tokens",
      "~$0.0042",
    ]);
    expect(turnUsageDetails(usage)).toEqual([
      "800 input",
      "400 output",
      "12 cached",
      "80 reasoning",
      "2 web searches",
      "~$0.0042",
    ]);
    expect(turnUsageSummary(usage, "12s")).toEqual([
      "12s",
      "1,234 tokens",
      "~$0.0042",
    ]);
    expect(formatUsdMicros(12_000)).toBe("$0.01");
  });

  test("maps a chat turn and a run letter into the same model", () => {
    expect(
      chatTurnUsage(
        chatTurn({
          startedAt: "2026-08-17T08:00:00.000Z",
          finishedAt: "2026-08-17T08:00:24.000Z",
          usage: chatUsage({
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            actualCostUsdMicros: 3_000,
          }),
        }),
      ),
    ).toEqual({
      durationMs: 24_000,
      totalTokens: 120,
      inputTokens: 100,
      outputTokens: 20,
      costUsdMicros: 3_000,
    });

    const run = runDetail({
      durationMs: 24_000,
      inputTokens: 800,
      outputTokens: 400,
      totalTokens: 1_200,
      cachedInputTokens: 10,
      actualCostUsdMicros: 5_000,
      costSource: "provider_reported",
      distiller: {
        modelIds: ["research/model"],
        calls: 1,
        inputTokens: 40,
        outputTokens: 8,
        totalTokens: 48,
        costUsdMicros: 900,
        costSource: "catalog_estimate",
      },
    });
    expect(runTurnUsage(run)).toEqual({
      durationMs: 24_000,
      totalTokens: 1_200,
      inputTokens: 800,
      outputTokens: 400,
      cachedInputTokens: 10,
      costUsdMicros: 5_000,
      distiller: {
        modelIds: ["research/model"],
        calls: 1,
        totalTokens: 48,
        costUsdMicros: 900,
        costEstimated: true,
      },
    });
    expect(turnUsageDistillerDetails(runTurnUsage(run))).toEqual([
      "research distiller",
      "research/model",
      "48 tokens",
      "~$0.0009",
      "1 call",
    ]);
  });

  test("sums live run usage events until the letter has totals", () => {
    const live = runDetail({
      status: "running",
    });
    const events: RunEventDto[] = [
      {
        id: "u1",
        sequence: 1,
        kind: "usage",
        title: "40 tokens used",
        occurredAt: "2026-08-17T08:00:01.000Z",
        usage: { totalTokens: 40, inputTokens: 30, outputTokens: 10 },
      },
      {
        id: "u2",
        sequence: 2,
        kind: "usage",
        title: "80 tokens used",
        occurredAt: "2026-08-17T08:00:08.000Z",
        usage: {
          totalTokens: 80,
          inputTokens: 50,
          outputTokens: 30,
          costUsdMicros: 1_200,
          costEstimated: true,
        },
      },
      {
        id: "image-usage",
        sequence: 3,
        kind: "usage",
        title: "1 image generated",
        occurredAt: "2026-08-17T08:00:10.000Z",
        usage: {
          operation: "image_generation",
          provider: "openrouter",
          modelId: "openai/gpt-image-2",
          imageCount: 1,
          totalTokens: 110,
          inputTokens: 10,
          outputTokens: 100,
          costUsdMicros: 130_000,
        },
      },
    ];
    expect(runTurnUsage(live, events)).toEqual({
      totalTokens: 230,
      inputTokens: 90,
      outputTokens: 140,
      costUsdMicros: 131_200,
      costEstimated: true,
      imageGenerations: [
        {
          provider: "openrouter",
          modelId: "openai/gpt-image-2",
          imageCount: 1,
          totalTokens: 110,
          costUsdMicros: 130_000,
        },
      ],
    });
    expect(turnUsageImageDetails(runTurnUsage(live, events))).toEqual([
      "image generation · openrouter · openai/gpt-image-2 · 1 image · 110 tokens · $0.13",
    ]);
    expect(
      runTurnUsage({ ...live, totalTokens: 120, inputTokens: 80 }, events),
    ).toMatchObject({
      totalTokens: 120,
      inputTokens: 80,
    });
  });
});

function chatUsage(overrides: Partial<ChatUsageDto> = {}): ChatUsageDto {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    actualCostUsdMicros: 0,
    estimatedCostUsdMicros: 0,
    webSearchRequests: 0,
    providerToolCalls: 0,
    ...overrides,
  };
}

function chatTurn(overrides: Partial<ChatTurnDto> = {}): ChatTurnDto {
  return {
    id: "turn-1",
    sessionId: "chat-1",
    status: "completed",
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-08-17T08:00:00.000Z",
    updatedAt: "2026-08-17T08:00:00.000Z",
    usage: chatUsage(),
    toolCalls: [],
    ...overrides,
  };
}

function runDetail(overrides: Partial<RunDetailDto> = {}): RunDetailDto {
  return {
    id: "run-1",
    taskId: "task-1",
    taskName: "Digest",
    status: "succeeded",
    scheduledTime: "2026-08-17T08:00:00.000Z",
    needsAttention: false,
    executionLocation: "local",
    toolCalls: 0,
    approvals: [],
    requiredApprovalIds: [],
    canRetry: false,
    ...overrides,
  };
}
