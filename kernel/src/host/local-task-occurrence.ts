import { and, desc, eq, inArray } from "drizzle-orm";
import { nextCronRun } from "../storage/cron-schedule-engine.ts";
import type { AppDatabase } from "../storage/database.ts";
import { runEvents, runs, tasks } from "../storage/schema.ts";

// Allow ordinary alarm delivery/startup jitter without treating it as downtime.
export const SCHEDULE_DELIVERY_GRACE_MS = 60_000;

export type ScheduledOccurrenceResult =
  | {
      readonly status: "claimed";
      readonly runId: string;
      readonly scheduledTime: Date;
      readonly nextRunAt: Date;
    }
  | {
      readonly status: "skipped_active" | "skipped_missed" | "duplicate";
      readonly nextRunAt: Date;
    }
  | { readonly status: "stale" | "disabled" | "missing" | "not_due" };

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
    if (expectedNextRunAt.getTime() > now.getTime()) {
      return { status: "not_due" };
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
    // Both policies coalesce downtime: catch_up runs once, never replays a
    // backlog. Advancing from the old cursor made behavior depend on how fast
    // the executor finished relative to the next overdue alarm.
    const nextRunAt = nextCronRun(task.schedule, task.timezone, now);
    const missed =
      now.getTime() - expectedNextRunAt.getTime() > SCHEDULE_DELIVERY_GRACE_MS;
    const recovery = (
      outcome: "caught_up" | "skipped_missed" | "skipped_active",
    ) => ({
      outcome,
      scheduledTime: expectedNextRunAt.toISOString(),
      recoveredAt: now.toISOString(),
    });

    if (missed && task.catchUpPolicy === "skip_to_next") {
      transaction
        .update(tasks)
        .set({
          nextRunAt,
          updatedAt: now,
          lastScheduleRecovery: recovery("skipped_missed"),
        })
        .where(
          and(eq(tasks.id, taskId), eq(tasks.nextRunAt, expectedNextRunAt)),
        )
        .run();
      return { status: "skipped_missed", nextRunAt };
    }

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
        .set({
          nextRunAt,
          updatedAt: now,
          lastScheduleRecovery: recovery("skipped_active"),
        })
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
      .set({
        nextRunAt,
        updatedAt: now,
        ...(claim && missed
          ? { lastScheduleRecovery: recovery("caught_up") }
          : {}),
      })
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
