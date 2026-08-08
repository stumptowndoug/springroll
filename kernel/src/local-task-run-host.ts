export interface LocalTaskRunHost {
  syncTask(taskId: string): Promise<void>;
  removeTask(taskId: string): Promise<void>;
  enqueueRun(runId: string, taskId: string, scheduledTime: Date): Promise<void>;
  shutdown(): Promise<void>;
}
