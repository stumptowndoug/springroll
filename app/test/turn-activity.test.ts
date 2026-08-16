import { describe, expect, test } from "bun:test";
import {
  formatDurationMs,
  type TurnStepInput,
  turnActivity,
  turnActivityTitle,
  turnStepWeight,
} from "../src/client/turn-activity.ts";

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
