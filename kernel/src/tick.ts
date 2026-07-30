import type { CatchUpPolicy } from "./contracts.ts";

export interface DueTask {
  readonly id: string;
  readonly nextRunAt: Date;
  readonly catchUpPolicy: CatchUpPolicy;
}

export interface RunClaim {
  readonly runId: string;
}

export interface TickStore {
  findDueTasks(now: Date): Promise<readonly DueTask[]>;
  claimOccurrence(
    taskId: string,
    scheduledTime: Date,
  ): Promise<RunClaim | undefined>;
  advanceTask(
    taskId: string,
    expectedNextRunAt: Date,
    nextRunAt: Date,
  ): Promise<void>;
}

export interface ScheduleEngine {
  nextAfter(taskId: string, after: Date): Promise<Date>;
}

export interface ScheduledRunExecutor {
  execute(runId: string, taskId: string, scheduledTime: Date): Promise<void>;
}

export interface TickDependencies {
  readonly store: TickStore;
  readonly schedule: ScheduleEngine;
  readonly executor: ScheduledRunExecutor;
}

export interface TickResult {
  readonly due: number;
  readonly claimed: number;
  readonly duplicate: number;
}

export async function tick(
  dependencies: TickDependencies,
  now = new Date(),
): Promise<TickResult> {
  const dueTasks = await dependencies.store.findDueTasks(now);
  let claimed = 0;
  let duplicate = 0;

  for (const task of dueTasks) {
    const claim = await dependencies.store.claimOccurrence(
      task.id,
      task.nextRunAt,
    );

    if (!claim) {
      duplicate += 1;
      continue;
    }

    claimed += 1;
    const scheduleCursor =
      task.catchUpPolicy === "catch_up" ? task.nextRunAt : now;
    const nextRunAt = await dependencies.schedule.nextAfter(
      task.id,
      scheduleCursor,
    );

    await dependencies.store.advanceTask(task.id, task.nextRunAt, nextRunAt);
    await dependencies.executor.execute(claim.runId, task.id, task.nextRunAt);
  }

  return {
    due: dueTasks.length,
    claimed,
    duplicate,
  };
}
