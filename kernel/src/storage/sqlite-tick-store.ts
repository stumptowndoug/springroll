import { and, asc, eq, lte } from "drizzle-orm";
import type { DueTask, RunClaim, TickStore } from "../tick.ts";
import type { AppDatabase } from "./database.ts";
import { runs, tasks } from "./schema.ts";

export class SqliteTickStore implements TickStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly executionLocation: "local" | "hosted" = "local",
  ) {}

  async findDueTasks(now: Date): Promise<readonly DueTask[]> {
    return this.db
      .select({
        id: tasks.id,
        nextRunAt: tasks.nextRunAt,
        catchUpPolicy: tasks.catchUpPolicy,
      })
      .from(tasks)
      .where(and(eq(tasks.enabled, true), lte(tasks.nextRunAt, now)))
      .orderBy(asc(tasks.nextRunAt), asc(tasks.id));
  }

  async claimOccurrence(
    taskId: string,
    scheduledTime: Date,
  ): Promise<RunClaim | undefined> {
    const [claim] = await this.db
      .insert(runs)
      .values({
        id: crypto.randomUUID(),
        taskId,
        scheduledTime,
        status: "claimed",
        executionLocation: this.executionLocation,
      })
      .onConflictDoNothing({
        target: [runs.taskId, runs.scheduledTime],
      })
      .returning({ runId: runs.id });

    return claim;
  }

  async advanceTask(
    taskId: string,
    expectedNextRunAt: Date,
    nextRunAt: Date,
  ): Promise<void> {
    const updated = this.db
      .update(tasks)
      .set({
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.nextRunAt, expectedNextRunAt)))
      .returning({ id: tasks.id })
      .get();

    if (!updated) {
      throw new Error(`Task schedule changed while ticking: ${taskId}`);
    }
  }
}
