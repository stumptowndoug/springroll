import { describe, expect, test } from "bun:test";
import {
  isClosedCoordinatorError,
  retryActorAction,
} from "../src/actor-action-retry.ts";

describe("Rivet actor action retry", () => {
  test("retries the transient closed-coordinator wake race", async () => {
    const error = new Error("actor action failed", {
      cause: new Error("SQLite transaction coordinator is closed"),
    });
    const delays: number[] = [];
    let calls = 0;

    const result = await retryActorAction(
      async () => {
        calls += 1;
        if (calls < 3) throw error;
        return "ready";
      },
      {
        delaysMs: [10, 20, 30],
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toBe("ready");
    expect(calls).toBe(3);
    expect(delays).toEqual([10, 20]);
    expect(isClosedCoordinatorError(error)).toBe(true);
  });

  test("does not retry ordinary action failures", async () => {
    const error = new Error("tool execution failed");
    let calls = 0;

    await expect(
      retryActorAction(
        async () => {
          calls += 1;
          throw error;
        },
        { delaysMs: [0], sleep: async () => {} },
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  test("stops after the configured transient retries", async () => {
    const error = new Error("SQLite transaction coordinator is closed");
    let calls = 0;

    await expect(
      retryActorAction(
        async () => {
          calls += 1;
          throw error;
        },
        { delaysMs: [0, 0], sleep: async () => {} },
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(3);
  });
});
