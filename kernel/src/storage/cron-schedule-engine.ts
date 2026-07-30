import { Cron } from "croner";
import { eq } from "drizzle-orm";
import type { ScheduleEngine } from "../tick.ts";
import type { AppDatabase } from "./database.ts";
import { tasks } from "./schema.ts";

export class CronScheduleEngine implements ScheduleEngine {
  constructor(private readonly db: AppDatabase) {}

  async nextAfter(taskId: string, after: Date): Promise<Date> {
    const [task] = await this.db
      .select({
        schedule: tasks.schedule,
        timezone: tasks.scheduleTimezone,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new Error(`Cannot schedule missing task: ${taskId}`);
    }

    return nextCronRun(task.schedule, task.timezone, after);
  }
}

export function nextCronRun(
  schedule: string,
  timezone: string,
  after: Date,
): Date {
  const nextRun = new Cron(schedule, {
    timezone,
    paused: true,
  }).nextRun(after);

  if (!nextRun) {
    throw new Error("Schedule has no next run");
  }

  return nextRun;
}
