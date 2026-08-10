export interface LocalTaskRunHost {
  syncTask(taskId: string): Promise<void>;
  removeTask(taskId: string): Promise<void>;
  enqueueRun(runId: string, taskId: string, scheduledTime: Date): Promise<void>;
  resumeRun(
    runId: string,
    taskId: string,
    decisions: readonly LocalRunApprovalDecision[],
  ): Promise<void>;
  shutdown(): Promise<void>;
}

export interface LocalRunApprovalDecision {
  readonly id: string;
  readonly approved: boolean;
  readonly reason?: string;
}
