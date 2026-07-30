import type { Task } from "@shrimp-roll/kernel";

export interface AppShell {
  showTask(task: Task): Promise<void>;
}
