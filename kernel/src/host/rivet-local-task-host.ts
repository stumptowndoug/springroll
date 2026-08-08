import { and, eq } from "drizzle-orm";
import { actor, queue, setup } from "rivetkit";
import { createClient } from "rivetkit/client";
import type {
  LocalRunApprovalDecision,
  LocalTaskRunHost,
} from "../local-task-run-host.ts";
import type { ScheduledRunExecutor } from "../scheduled-run-executor.ts";
import type { AppDatabase } from "../storage/database.ts";
import { runs, tasks } from "../storage/schema.ts";
import { retryActorAction } from "./actor-action-retry.ts";
import { claimLocalScheduledOccurrence } from "./local-task-occurrence.ts";

interface LocalTaskActorState {
  scheduleEventId: string | null;
  nextRunAt: string | null;
  queuedRunIds: string[];
}

type QueuedLocalRun =
  | {
      kind: "execute";
      runId: string;
      taskId: string;
      scheduledTime: string;
    }
  | {
      kind: "resume";
      runId: string;
      taskId: string;
      decisions: readonly LocalRunApprovalDecision[];
    };

interface LocalActorRunExecutor extends ScheduledRunExecutor {
  approveResume(
    runId: string,
    decisions: readonly LocalRunApprovalDecision[],
  ): void;
  resumeApproved(runId: string): Promise<void>;
}

export interface CreateLocalRivetTaskHostOptions {
  readonly db: AppDatabase;
  readonly executor: LocalActorRunExecutor;
  readonly endpoint: string;
  readonly now?: () => Date;
  readonly onError?: (error: unknown) => void;
}

export async function createLocalRivetTaskHost(
  options: CreateLocalRivetTaskHostOptions,
): Promise<LocalTaskRunHost> {
  const now = options.now ?? (() => new Date());
  const localTaskActor = actor({
    state: {
      scheduleEventId: null,
      nextRunAt: null,
      queuedRunIds: [],
    } as LocalTaskActorState,
    queues: { runs: queue<QueuedLocalRun>() },
    actions: {
      sync: async (c, taskId: string) => {
        await syncSchedule(c, options.db, taskId);
        const claimedRuns = options.db
          .select({
            id: runs.id,
            scheduledTime: runs.scheduledTime,
          })
          .from(runs)
          .where(and(eq(runs.taskId, taskId), eq(runs.status, "claimed")))
          .all();
        for (const run of claimedRuns) {
          await queueRun(c, {
            kind: "execute",
            runId: run.id,
            taskId,
            scheduledTime: run.scheduledTime.toISOString(),
          });
        }
      },
      remove: async (c) => {
        if (c.state.scheduleEventId) {
          await c.schedule.cancel(c.state.scheduleEventId);
        }
        c.state.scheduleEventId = null;
        c.state.nextRunAt = null;
        await c.saveState({ immediate: true });
      },
      enqueueRun: (c, run: QueuedLocalRun) => queueRun(c, run),
      resumeRun: async (
        c,
        runId: string,
        taskId: string,
        decisions: readonly LocalRunApprovalDecision[],
      ) => {
        await queueRun(c, {
          kind: "resume",
          runId,
          taskId,
          decisions,
        });
      },
      fireScheduled: async (
        c,
        taskId: string,
        expectedNextRunAt: string,
        fire?: { readonly id: string },
      ) => {
        if (fire && c.state.scheduleEventId !== fire.id) {
          return "superseded";
        }
        c.state.scheduleEventId = null;
        c.state.nextRunAt = null;
        const result = claimLocalScheduledOccurrence(
          options.db,
          taskId,
          new Date(expectedNextRunAt),
          now(),
        );
        if (result.status === "claimed") {
          await queueRun(c, {
            kind: "execute",
            runId: result.runId,
            taskId,
            scheduledTime: result.scheduledTime.toISOString(),
          });
        }
        await syncSchedule(c, options.db, taskId);
        return result.status;
      },
    },
    run: async (c) => {
      for await (const message of c.queue.iter({ names: ["runs"] })) {
        const run = message.body;
        try {
          await c.keepAwake(
            run.kind === "execute"
              ? options.executor.execute(
                  run.runId,
                  run.taskId,
                  new Date(run.scheduledTime),
                )
              : resumeLocalRun(options.executor, run),
          );
        } catch (error) {
          options.onError?.(error);
        } finally {
          const messageKey = queuedRunKey(run);
          c.state.queuedRunIds = c.state.queuedRunIds.filter(
            (id) => id !== messageKey,
          );
          await c.saveState({ immediate: true });
        }
      }
    },
  });
  const registry = setup({ use: { localTaskActor } });
  await registry.startAndWait();
  const client = createClient<typeof registry>(options.endpoint);
  const actorHandle = (taskId: string) =>
    client.localTaskActor.getOrCreate([taskId]);
  const call = <T>(action: () => Promise<T>) =>
    retryActorAction(action, (attempt, delayMs) => {
      console.warn(
        `Rivet actor was still waking; retrying action (attempt ${attempt}) in ${delayMs}ms`,
      );
    });
  const taskIds = options.db.select({ id: tasks.id }).from(tasks).all();
  await Promise.all(
    taskIds.map(({ id }) => call(() => actorHandle(id).sync(id))),
  );

  return {
    syncTask: (taskId) => call(() => actorHandle(taskId).sync(taskId)),
    removeTask: (taskId) => call(() => actorHandle(taskId).remove()),
    enqueueRun: (runId, taskId, scheduledTime) =>
      call(() =>
        actorHandle(taskId).enqueueRun({
          kind: "execute",
          runId,
          taskId,
          scheduledTime: scheduledTime.toISOString(),
        }),
      ),
    resumeRun: (runId, taskId, decisions) =>
      call(() => actorHandle(taskId).resumeRun(runId, taskId, decisions)),
    async shutdown() {
      await client.dispose();
      await registry.shutdown();
    },
  };
}

async function syncSchedule(
  c: {
    state: LocalTaskActorState;
    schedule: {
      at(
        timestamp: number,
        action: string,
        ...args: unknown[]
      ): Promise<string>;
      cancel(id: string): Promise<boolean>;
    };
    saveState(options: { immediate: true }): Promise<void>;
  },
  db: AppDatabase,
  taskId: string,
): Promise<void> {
  const task = db
    .select({ enabled: tasks.enabled, nextRunAt: tasks.nextRunAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  const desiredNextRunAt = task?.enabled ? task.nextRunAt.toISOString() : null;
  if (c.state.nextRunAt === desiredNextRunAt) return;
  if (c.state.scheduleEventId) {
    await c.schedule.cancel(c.state.scheduleEventId);
  }
  c.state.scheduleEventId = null;
  c.state.nextRunAt = desiredNextRunAt;
  if (task?.enabled) {
    c.state.scheduleEventId = await c.schedule.at(
      task.nextRunAt.getTime(),
      "fireScheduled",
      taskId,
      desiredNextRunAt,
    );
  }
  await c.saveState({ immediate: true });
}

async function queueRun(
  c: {
    state: LocalTaskActorState;
    queue: { send(name: "runs", body: QueuedLocalRun): Promise<unknown> };
    saveState(options: { immediate: true }): Promise<void>;
  },
  run: QueuedLocalRun,
): Promise<void> {
  const messageKey = queuedRunKey(run);
  if (c.state.queuedRunIds.includes(messageKey)) return;
  await c.queue.send("runs", run);
  c.state.queuedRunIds.push(messageKey);
  if (c.state.queuedRunIds.length > 100) c.state.queuedRunIds.shift();
  await c.saveState({ immediate: true });
}

function queuedRunKey(run: QueuedLocalRun): string {
  return `${run.kind}:${run.runId}`;
}

async function resumeLocalRun(
  executor: LocalActorRunExecutor,
  run: Extract<QueuedLocalRun, { kind: "resume" }>,
): Promise<void> {
  executor.approveResume(run.runId, run.decisions);
  await executor.resumeApproved(run.runId);
}
