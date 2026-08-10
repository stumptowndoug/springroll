import { eq } from "drizzle-orm";
import type { ScheduledRunExecutor } from "../scheduled-run-executor.ts";
import type { AppDatabase } from "./database.ts";
import { runEvents, runs } from "./schema.ts";

export class StubRunExecutor implements ScheduledRunExecutor {
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    runId: string,
    taskId: string,
    scheduledTime: Date,
  ): Promise<void> {
    const startedAt = this.now();

    this.db.transaction((transaction) => {
      transaction
        .update(runs)
        .set({ status: "running", startedAt })
        .where(eq(runs.id, runId))
        .run();
      transaction
        .insert(runEvents)
        .values([
          {
            id: crypto.randomUUID(),
            runId,
            sequence: 0,
            type: "run_started",
            payload: {
              taskId,
              scheduledTime: scheduledTime.toISOString(),
            },
            createdAt: startedAt,
          },
          {
            id: crypto.randomUUID(),
            runId,
            sequence: 1,
            type: "stub_output",
            payload: {
              summary: "Stub executor completed the scheduled occurrence.",
            },
            createdAt: startedAt,
          },
          {
            id: crypto.randomUUID(),
            runId,
            sequence: 2,
            type: "run_succeeded",
            payload: {},
            createdAt: startedAt,
          },
        ])
        .run();
      transaction
        .update(runs)
        .set({
          status: "succeeded",
          finishedAt: this.now(),
        })
        .where(eq(runs.id, runId))
        .run();
    });
  }
}
