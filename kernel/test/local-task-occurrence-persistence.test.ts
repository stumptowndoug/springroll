import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { claimLocalScheduledOccurrence } from "../src/host/local-task-occurrence.ts";
import {
  type LocalDatabase,
  openLocalDatabase,
} from "../src/storage/database.ts";
import { runEvents, runs, tasks } from "../src/storage/schema.ts";
import { StubRunExecutor } from "../src/storage/stub-run-executor.ts";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function openTemporaryDatabase(): Promise<{
  database: LocalDatabase;
  filename: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "springroll-actor-"));
  const filename = join(directory, "occurrences.db");
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

describe("local task actor occurrence persistence", () => {
  test("persists one immutable run across database restart", async () => {
    const { database, filename } = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    const now = new Date("2026-07-31T15:00:30.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-due",
        prompt: "Run through the actor",
        schedule: "0 15 * * *",
        scheduleTimezone: "UTC",
        catchUpPolicy: "catch_up",
        nextRunAt: scheduledTime,
      })
      .run();

    const claim = claimLocalScheduledOccurrence(
      database.db,
      "task-due",
      scheduledTime,
      now,
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Expected a run claim");
    await new StubRunExecutor(database.db, () => now).execute(
      claim.runId,
      "task-due",
      claim.scheduledTime,
    );

    const storedEvents = database.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, claim.runId))
      .all();
    expect(database.db.select().from(runs).all()).toHaveLength(1);
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
      claimLocalScheduledOccurrence(reopened.db, "task-due", scheduledTime, now)
        .status,
    ).toBe("stale");
    expect(reopened.db.select().from(runs).all()).toHaveLength(1);
  });

  test("does not admit disabled tasks", async () => {
    const { database } = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-disabled",
        prompt: "Do not run",
        schedule: "0 15 * * *",
        enabled: false,
        nextRunAt: scheduledTime,
      })
      .run();

    expect(
      claimLocalScheduledOccurrence(database.db, "task-disabled", scheduledTime)
        .status,
    ).toBe("disabled");
    expect(database.db.select().from(runs).all()).toHaveLength(0);
  });
});
