import { describe, expect, test } from "bun:test";
import {
  formatDurationMs,
  type TurnStepInput,
  runTurnActivity,
  turnActivity,
  turnActivityTitle,
  turnStepWeight,
} from "../src/client/turn-activity.ts";
import type { RunEventDto } from "../src/shared.ts";

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
        tone: "success",
        occurredAt: "2026-08-17T08:00:01.000Z",
      },
      {
        id: "res-2",
        sequence: 5,
        kind: "tool",
        title: "Tool call finished",
        tone: "success",
        occurredAt: "2026-08-17T08:00:02.000Z",
      },
      {
        id: "res-3",
        sequence: 6,
        kind: "tool",
        title: "Tool call finished",
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

