import { describe, expect, test } from "bun:test";
import { type TickStore, tick } from "../src/tick.ts";

describe("tick", () => {
  test("claims a due occurrence before executing it", async () => {
    const events: string[] = [];
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    const store: TickStore = {
      async findDueTasks() {
        return [
          {
            id: "task-1",
            nextRunAt: scheduledTime,
            catchUpPolicy: "catch_up",
          },
        ];
      },
      async claimOccurrence() {
        events.push("claim");
        return { runId: "run-1" };
      },
      async advanceTask() {
        events.push("advance");
      },
    };

    const result = await tick(
      {
        store,
        schedule: {
          async nextAfter() {
            return new Date("2026-08-01T15:00:00.000Z");
          },
        },
        executor: {
          async execute() {
            events.push("execute");
          },
        },
      },
      new Date("2026-07-31T15:00:30.000Z"),
    );

    expect(events).toEqual(["claim", "advance", "execute"]);
    expect(result).toEqual({ due: 1, claimed: 1, duplicate: 0 });
  });

  test("does not execute an occurrence another tick already claimed", async () => {
    let executed = false;

    const result = await tick({
      store: {
        async findDueTasks() {
          return [
            {
              id: "task-1",
              nextRunAt: new Date("2026-07-31T15:00:00.000Z"),
              catchUpPolicy: "skip_to_next",
            },
          ];
        },
        async claimOccurrence() {
          return undefined;
        },
        async advanceTask() {
          throw new Error("duplicate occurrence should not advance");
        },
      },
      schedule: {
        async nextAfter() {
          throw new Error("duplicate occurrence should not be rescheduled");
        },
      },
      executor: {
        async execute() {
          executed = true;
        },
      },
    });

    expect(executed).toBe(false);
    expect(result).toEqual({ due: 1, claimed: 0, duplicate: 1 });
  });
});
