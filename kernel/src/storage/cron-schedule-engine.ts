import { Cron } from "croner";

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
