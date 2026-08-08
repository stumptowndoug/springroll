export interface ScheduledRunExecutor {
  execute(runId: string, taskId: string, scheduledTime: Date): Promise<void>;
}
