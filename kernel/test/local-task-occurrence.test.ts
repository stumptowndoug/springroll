import { afterEach, describe, expect, test } from "bun:test";
import { claimLocalScheduledOccurrence } from "../src/host/local-task-occurrence.ts";
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
  test("claims and advances catch-up and skip cursors in local SQLite", () => {
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
    expect(skipped.status).toBe("claimed");
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
      { id: "catch-up", nextRunAt: "2026-08-08T08:00:00.000Z" },
      { id: "skip", nextRunAt: "2026-08-09T08:00:00.000Z" },
    ]);
    expect(database.db.select().from(runs).all()).toHaveLength(2);
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
