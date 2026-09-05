import { afterEach, describe, expect, test } from "bun:test";
import {
  claimLocalScheduledOccurrence,
  SCHEDULE_DELIVERY_GRACE_MS,
} from "../src/host/local-task-occurrence.ts";
import {
  type LocalDatabase,
  openLocalDatabase,
} from "../src/storage/database.ts";
import { runEvents, runs, tasks } from "../src/storage/schema.ts";
import { SqliteAgentEventSink } from "../src/storage/sqlite-agent-event-sink.ts";

const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function openDatabase(): LocalDatabase {
  const database = openLocalDatabase({ filename: ":memory:" });
  databases.push(database);
  return database;
}

describe("local task actor occurrence claims", () => {
  for (const policy of ["catch_up", "skip_to_next"] as const) {
    for (const delay of [-1, 0, 30_000, SCHEDULE_DELIVERY_GRACE_MS, 60_001]) {
      test(`${policy} handles delivery delay ${delay}ms`, () => {
        const database = openDatabase();
        const due = new Date("2026-09-04T08:00:00Z");
        database.db
          .insert(tasks)
          .values({
            id: "task",
            prompt: "Daily summary",
            schedule: "0 8 * * *",
            scheduleTimezone: "UTC",
            catchUpPolicy: policy,
            nextRunAt: due,
          })
          .run();
        const result = claimLocalScheduledOccurrence(
          database.db,
          "task",
          due,
          new Date(due.getTime() + delay),
        );
        const expected =
          delay < 0
            ? "not_due"
            : policy === "skip_to_next" && delay > SCHEDULE_DELIVERY_GRACE_MS
              ? "skipped_missed"
              : "claimed";
        expect(result.status).toBe(expected);
        expect(database.db.select().from(runs).all()).toHaveLength(
          expected === "claimed" ? 1 : 0,
        );
        expect(
          database.db.select().from(tasks).get()?.nextRunAt.toISOString(),
        ).toBe(delay < 0 ? due.toISOString() : "2026-09-05T08:00:00.000Z");
      });
    }
  }

  for (const status of [
    "claimed",
    "running",
    "waiting_for_approval",
  ] as const) {
    test(`does not overlap a ${status} run after weekend downtime`, () => {
      const database = openDatabase();
      const due = new Date("2026-09-04T08:00:00Z");
      database.db
        .insert(tasks)
        .values({
          id: "task",
          prompt: "Daily summary",
          schedule: "0 8 * * *",
          scheduleTimezone: "UTC",
          catchUpPolicy: "catch_up",
          nextRunAt: due,
        })
        .run();
      database.db
        .insert(runs)
        .values({
          id: "active",
          taskId: "task",
          scheduledTime: new Date("2026-09-03T08:00:00Z"),
          status,
          executionLocation: "local",
        })
        .run();
      expect(
        claimLocalScheduledOccurrence(
          database.db,
          "task",
          due,
          new Date("2026-09-07T10:00:00Z"),
        ).status,
      ).toBe("skipped_active");
      expect(database.db.select().from(runs).all()).toHaveLength(1);
      expect(
        database.db.select().from(tasks).get()?.nextRunAt.toISOString(),
      ).toBe("2026-09-08T08:00:00.000Z");
    });
  }

  for (const [dueText, nowText, nextText] of [
    [
      "2026-03-06T16:00:00Z",
      "2026-03-09T17:00:00Z",
      "2026-03-10T15:00:00.000Z",
    ],
    [
      "2026-10-30T15:00:00Z",
      "2026-11-02T18:00:00Z",
      "2026-11-03T16:00:00.000Z",
    ],
  ] as const) {
    test(`coalesces a weekend across DST from ${dueText}`, () => {
      const database = openDatabase();
      const due = new Date(dueText);
      const now = new Date(nowText);
      database.db
        .insert(tasks)
        .values({
          id: "task",
          prompt: "Daily summary",
          schedule: "0 8 * * *",
          scheduleTimezone: "America/Los_Angeles",
          catchUpPolicy: "catch_up",
          nextRunAt: due,
        })
        .run();
      expect(
        claimLocalScheduledOccurrence(database.db, "task", due, now).status,
      ).toBe("claimed");
      expect(
        database.db.select().from(tasks).get()?.nextRunAt.toISOString(),
      ).toBe(nextText);
      expect(
        claimLocalScheduledOccurrence(database.db, "task", due, now).status,
      ).toBe("stale");
      expect(database.db.select().from(runs).all()).toHaveLength(1);
    });
  }

  test("runs catch-up once and skips missed work with both cursors in the future", () => {
    const database = openDatabase();
    const missed = new Date("2026-08-07T08:00:00.000Z");
    const now = new Date("2026-08-08T10:00:00.000Z");
    database.db
      .insert(tasks)
      .values([
        {
          id: "catch-up",
          prompt: "Catch up",
          schedule: "0 8 * * *",
          scheduleTimezone: "UTC",
          catchUpPolicy: "catch_up",
          nextRunAt: missed,
        },
        {
          id: "skip",
          prompt: "Skip",
          schedule: "0 8 * * *",
          scheduleTimezone: "UTC",
          catchUpPolicy: "skip_to_next",
          nextRunAt: missed,
        },
      ])
      .run();

    const caughtUp = claimLocalScheduledOccurrence(
      database.db,
      "catch-up",
      missed,
      now,
    );
    const skipped = claimLocalScheduledOccurrence(
      database.db,
      "skip",
      missed,
      now,
    );

    expect(caughtUp.status).toBe("claimed");
    expect(skipped.status).toBe("skipped_missed");
    expect(
      database.db
        .select()
        .from(tasks)
        .all()
        .map((task) => task.lastScheduleRecovery),
    ).toEqual([
      {
        outcome: "caught_up",
        scheduledTime: missed.toISOString(),
        recoveredAt: now.toISOString(),
      },
      {
        outcome: "skipped_missed",
        scheduledTime: missed.toISOString(),
        recoveredAt: now.toISOString(),
      },
    ]);
    expect(
      database.db
        .select()
        .from(tasks)
        .all()
        .map((task) => ({
          id: task.id,
          nextRunAt: task.nextRunAt.toISOString(),
        })),
    ).toEqual([
      { id: "catch-up", nextRunAt: "2026-08-09T08:00:00.000Z" },
      { id: "skip", nextRunAt: "2026-08-09T08:00:00.000Z" },
    ]);
    expect(database.db.select().from(runs).all()).toHaveLength(1);
  });

  test("rejects stale fires and reports when catch-up skips an overlap", async () => {
    const database = openDatabase();
    const due = new Date("2026-08-08T08:00:00.000Z");
    const now = new Date("2026-08-08T10:00:00.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task",
        prompt: "Run once",
        schedule: "0 8 * * *",
        scheduleTimezone: "UTC",
        catchUpPolicy: "catch_up",
        nextRunAt: due,
      })
      .run();
    database.db
      .insert(runs)
      .values({
        id: "active",
        taskId: "task",
        scheduledTime: new Date("2026-08-08T07:00:00.000Z"),
        status: "running",
        executionLocation: "local",
      })
      .run();
    database.db
      .insert(runEvents)
      .values({
        id: "active-started",
        runId: "active",
        sequence: 0,
        type: "run_started",
        payload: {},
        createdAt: new Date("2026-08-08T07:00:00.000Z"),
      })
      .run();
    const activeSink = new SqliteAgentEventSink(database.db, "active");

    expect(
      claimLocalScheduledOccurrence(
        database.db,
        "task",
        new Date("2026-08-08T06:00:00.000Z"),
        now,
      ).status,
    ).toBe("stale");
    const result = claimLocalScheduledOccurrence(database.db, "task", due, now);
    expect(result.status).toBe("skipped_active");
    expect(database.db.select().from(runs).all()).toHaveLength(1);
    expect(
      database.db.select().from(tasks).get()?.nextRunAt.toISOString(),
    ).toBe("2026-08-09T08:00:00.000Z");
    expect(
      database.db
        .select()
        .from(runEvents)
        .all()
        .map((event) => ({
          sequence: event.sequence,
          type: event.type,
          payload: event.payload,
        })),
    ).toEqual([
      { sequence: 0, type: "run_started", payload: {} },
      {
        sequence: 1,
        type: "schedule_catch_up_skipped",
        payload: {
          scheduledTime: due.toISOString(),
          reason:
            "A scheduled catch-up was skipped because this run was still active.",
        },
      },
    ]);
    await expect(
      activeSink.append({ type: "lifecycle", phase: "completed" }, now),
    ).resolves.toMatchObject({ sequence: 2 });
  });
});
