import { describe, expect, test } from "bun:test";
import { selectEmergencyBoundary } from "../src/agent-loop-policy.ts";

describe("agent loop policy", () => {
  test("selects token, time, then step wrap-up in that order", () => {
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 20,
        maxCumulativeInputTokens: 20,
        elapsedMs: 5_000,
        maxActiveDurationMs: 1_000,
        stepNumber: 19,
        wrapUpFromStep: 19,
      }),
    ).toBe("context");
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 1,
        maxCumulativeInputTokens: 20,
        elapsedMs: 5_000,
        maxActiveDurationMs: 1_000,
        stepNumber: 19,
        wrapUpFromStep: 19,
      }),
    ).toBe("execution-time");
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 1,
        maxCumulativeInputTokens: 20,
        elapsedMs: 10,
        maxActiveDurationMs: 1_000,
        stepNumber: 19,
        wrapUpFromStep: 19,
      }),
    ).toBe("step-count");
    expect(
      selectEmergencyBoundary({
        cumulativeInputTokens: 1,
        maxCumulativeInputTokens: 20,
        elapsedMs: 10,
        maxActiveDurationMs: 1_000,
        stepNumber: 3,
        wrapUpFromStep: 19,
      }),
    ).toBeUndefined();
  });
});
