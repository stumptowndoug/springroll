import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { CronScheduleEngine } from "../src/storage/cron-schedule-engine.ts";
import {
  type LocalDatabase,
  openLocalDatabase,
} from "../src/storage/database.ts";
import { runEvents, runs, tasks } from "../src/storage/schema.ts";
import { SqliteTickStore } from "../src/storage/sqlite-tick-store.ts";
import { StubRunExecutor } from "../src/storage/stub-run-executor.ts";
import { tick } from "../src/tick.ts";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function openTemporaryDatabase(): Promise<{
  database: LocalDatabase;
  filename: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "springroll-"));
  const filename = join(directory, "heartbeat.db");
  const database = openLocalDatabase({ filename });

  cleanup.push(async () => {
    try {
      database.close();
    } catch {
      // A test may close early to verify reopening.
    }
    await rm(directory, { recursive: true, force: true });
  });

  return { database, filename };
}

describe("SQLite scheduling heartbeat", () => {
  test("persists one immutable run per occurrence across restart", async () => {
    const { database, filename } = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    const now = new Date("2026-07-31T15:00:30.000Z");

    database.db
      .insert(tasks)
      .values([
        {
          id: "task-due",
          prompt: "Run the heartbeat",
          schedule: "0 15 * * *",
          scheduleTimezone: "UTC",
          enabled: true,
          catchUpPolicy: "catch_up",
          nextRunAt: scheduledTime,
        },
        {
          id: "task-disabled",
          prompt: "Do not run",
          schedule: "0 15 * * *",
          scheduleTimezone: "UTC",
          enabled: false,
          catchUpPolicy: "catch_up",
          nextRunAt: scheduledTime,
        },
      ])
      .run();

    const dependencies = {
      store: new SqliteTickStore(database.db),
      schedule: new CronScheduleEngine(database.db),
      executor: new StubRunExecutor(database.db, () => now),
    };

    expect(await tick(dependencies, now)).toEqual({
      due: 1,
      claimed: 1,
      duplicate: 0,
    });
    expect(await tick(dependencies, now)).toEqual({
      due: 0,
      claimed: 0,
      duplicate: 0,
    });

    const storedRuns = database.db.select().from(runs).all();
    const storedEvents = database.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, storedRuns[0]?.id ?? "missing"))
      .all();

    expect(storedRuns).toHaveLength(1);
    expect(storedRuns[0]?.status).toBe("succeeded");
    expect(storedRuns[0]?.scheduledTime).toEqual(scheduledTime);
    expect(storedEvents.map((event) => event.type)).toEqual([
      "run_started",
      "stub_output",
      "run_succeeded",
    ]);

    database.close();
    const reopened = openLocalDatabase({ filename });
    cleanup.push(() => reopened.close());

    expect(reopened.db.select().from(runs).all()).toHaveLength(1);
    expect(
      await tick(
        {
          store: new SqliteTickStore(reopened.db),
          schedule: new CronScheduleEngine(reopened.db),
          executor: new StubRunExecutor(reopened.db, () => now),
        },
        now,
      ),
    ).toEqual({ due: 0, claimed: 0, duplicate: 0 });
  });

  test("enforces occurrence deduplication under competing claims", async () => {
    const { database } = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-concurrent",
        prompt: "Claim me once",
        schedule: "0 15 * * *",
        nextRunAt: scheduledTime,
      })
      .run();

    const store = new SqliteTickStore(database.db);
    const claims = await Promise.all([
      store.claimOccurrence("task-concurrent", scheduledTime),
      store.claimOccurrence("task-concurrent", scheduledTime),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(database.db.select().from(runs).all()).toHaveLength(1);
  });

  test("advances catch-up and skip policies from different cursors", async () => {
    const { database } = await openTemporaryDatabase();
    const missedTime = new Date("2026-07-30T08:00:00.000Z");
    const now = new Date("2026-07-31T10:00:00.000Z");

    database.db
      .insert(tasks)
      .values([
        {
          id: "task-catch-up",
          prompt: "Catch up one occurrence at a time",
          schedule: "0 8 * * *",
          scheduleTimezone: "UTC",
          catchUpPolicy: "catch_up",
          nextRunAt: missedTime,
        },
        {
          id: "task-skip",
          prompt: "Skip missed occurrences",
          schedule: "0 8 * * *",
          scheduleTimezone: "UTC",
          catchUpPolicy: "skip_to_next",
          nextRunAt: missedTime,
        },
      ])
      .run();

    await tick(
      {
        store: new SqliteTickStore(database.db),
        schedule: new CronScheduleEngine(database.db),
        executor: new StubRunExecutor(database.db, () => now),
      },
      now,
    );

    const scheduledTasks = database.db
      .select({
        id: tasks.id,
        nextRunAt: tasks.nextRunAt,
      })
      .from(tasks)
      .all();
    const nextRuns = Object.fromEntries(
      scheduledTasks.map((task) => [task.id, task.nextRunAt.toISOString()]),
    );

    expect(nextRuns).toEqual({
      "task-catch-up": "2026-07-31T08:00:00.000Z",
      "task-skip": "2026-08-01T08:00:00.000Z",
    });
  });
});
