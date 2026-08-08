import { and, desc, eq, inArray } from "drizzle-orm";
import { nextCronRun } from "../storage/cron-schedule-engine.ts";
import type { AppDatabase } from "../storage/database.ts";
import { runEvents, runs, tasks } from "../storage/schema.ts";

export type ScheduledOccurrenceResult =
  | {
      readonly status: "claimed";
      readonly runId: string;
      readonly scheduledTime: Date;
      readonly nextRunAt: Date;
    }
  | {
      readonly status: "skipped_active" | "duplicate";
      readonly nextRunAt: Date;
    }
  | { readonly status: "stale" | "disabled" | "missing" };

/**
 * Claims one actor-owned scheduled occurrence in local SQLite and advances the
 * authoritative task cursor in the same transaction.
 */
export function claimLocalScheduledOccurrence(
  db: AppDatabase,
  taskId: string,
  expectedNextRunAt: Date,
  now = new Date(),
): ScheduledOccurrenceResult {
  return db.transaction((transaction) => {
    const task = transaction
      .select({
        enabled: tasks.enabled,
        schedule: tasks.schedule,
        timezone: tasks.scheduleTimezone,
        catchUpPolicy: tasks.catchUpPolicy,
        nextRunAt: tasks.nextRunAt,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    if (!task) return { status: "missing" };
    if (!task.enabled) return { status: "disabled" };
    if (task.nextRunAt.getTime() !== expectedNextRunAt.getTime()) {
      return { status: "stale" };
    }

    const activeRun = transaction
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.taskId, taskId),
          inArray(runs.status, ["claimed", "running", "waiting_for_approval"]),
        ),
      )
      .get();
    const scheduleCursor =
      task.catchUpPolicy === "catch_up" && !activeRun ? expectedNextRunAt : now;
    const nextRunAt = nextCronRun(task.schedule, task.timezone, scheduleCursor);

    if (activeRun) {
      if (task.catchUpPolicy === "catch_up") {
        const latest = transaction
          .select({ sequence: runEvents.sequence })
          .from(runEvents)
          .where(eq(runEvents.runId, activeRun.id))
          .orderBy(desc(runEvents.sequence))
          .limit(1)
          .get();
        transaction
          .insert(runEvents)
          .values({
            id: crypto.randomUUID(),
            runId: activeRun.id,
            sequence: (latest?.sequence ?? -1) + 1,
            type: "schedule_catch_up_skipped",
            payload: {
              scheduledTime: expectedNextRunAt.toISOString(),
              reason:
                "A scheduled catch-up was skipped because this run was still active.",
            },
            createdAt: now,
          })
          .run();
      }
      transaction
        .update(tasks)
        .set({ nextRunAt, updatedAt: now })
        .where(
          and(eq(tasks.id, taskId), eq(tasks.nextRunAt, expectedNextRunAt)),
        )
        .run();
      return { status: "skipped_active", nextRunAt };
    }

    const runId = crypto.randomUUID();
    const claim = transaction
      .insert(runs)
      .values({
        id: runId,
        taskId,
        scheduledTime: expectedNextRunAt,
        status: "claimed",
        executionLocation: "local",
      })
      .onConflictDoNothing({ target: [runs.taskId, runs.scheduledTime] })
      .returning({ id: runs.id })
      .get();

    transaction
      .update(tasks)
      .set({ nextRunAt, updatedAt: now })
      .where(and(eq(tasks.id, taskId), eq(tasks.nextRunAt, expectedNextRunAt)))
      .run();

    return claim
      ? {
          status: "claimed",
          runId,
          scheduledTime: expectedNextRunAt,
          nextRunAt,
        }
      : { status: "duplicate", nextRunAt };
  });
}
