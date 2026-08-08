import {
  type AgentEventPayloadV1,
  type AgentEventSink,
  type AgentEventV1,
  AgentRunApprovalRequiredError,
  type AgentRunRequest,
  AiSdkAgentRunner,
  runTask,
} from "@springroll/kernel";
import { modelMessageSchema } from "ai";
import { eq } from "drizzle-orm";
import { actor, queue, setup } from "rivetkit";
import { db as rivetDrizzle } from "rivetkit/db/drizzle";
import {
  migrationStatements,
  runCheckpoints,
  runEvents,
  runs,
  schema,
} from "./db-schema.ts";
import {
  buildDigestTask,
  digestConnections,
  getToolSource,
} from "./digest-task.ts";
import { freshRunModel, resumeRunModel } from "./mock-model.ts";

interface PendingApproval {
  runId: string;
  approvals: {
    id: string;
    toolCallId: string;
    toolName: string;
    riskEffect: string;
  }[];
}

interface TaskActorState {
  prompt: string;
  runCounter: number;
  activeRunId: string | null;
  pendingApproval: PendingApproval | null;
  approvalQueuedRunId: string | null;
  wakeLog: string[];
}

type QueuedRun =
  | {
      kind: "occurrence";
      scheduledTime: string;
      preRunDelayMs: number;
    }
  | {
      kind: "approval";
      runId: string;
      approved: boolean;
    };

const dbProvider = rivetDrizzle({
  schema,
  onMigrate: async (database) => {
    for (const statement of migrationStatements) {
      await database.execute(statement);
    }
  },
});

type SpikeDb = Awaited<ReturnType<typeof dbProvider.createClient>>;

interface SpikeActorContext {
  state: TaskActorState;
  readonly db: SpikeDb;
  saveState(opts?: { immediate?: boolean }): Promise<void>;
  broadcast(name: string, ...args: unknown[]): void;
  readonly abortSignal: AbortSignal;
}

export const taskActor = actor({
  state: {
    prompt:
      "Summarize the top three Hacker News stories, then publish the digest to the spike channel.",
    runCounter: 0,
    activeRunId: null,
    pendingApproval: null,
    approvalQueuedRunId: null,
    wakeLog: [],
  } as TaskActorState,
  db: dbProvider,
  queues: {
    runs: queue<QueuedRun>(),
  },
  onWake: (c) => {
    c.state.wakeLog.push(new Date().toISOString());
    if (c.state.wakeLog.length > 20) c.state.wakeLog.shift();
  },
  actions: {
    configure: (c, prompt: string) => {
      c.state.prompt = prompt;
      return { prompt };
    },

    setCron: async (c, expression: string) => {
      await c.cron.set({
        name: "occurrence",
        expression,
        action: "fireOccurrence",
        timezone: "UTC",
      });
      return c.cron.get("occurrence");
    },

    clearCron: (c) => c.cron.delete("occurrence"),

    scheduleIn: (c, delayMs: number) =>
      c.schedule.after(delayMs, "fireOccurrence"),

    fireOccurrence: async (c, delayOrScheduleInfo?: unknown) => {
      if (c.state.activeRunId) {
        return { skipped: true, reason: `run active: ${c.state.activeRunId}` };
      }
      if (c.state.pendingApproval) {
        return {
          skipped: true,
          reason: `awaiting approval: ${c.state.pendingApproval.runId}`,
        };
      }
      const scheduledTime = new Date();
      const preRunDelayMs =
        typeof delayOrScheduleInfo === "number" ? delayOrScheduleInfo : 0;
      if (!Number.isFinite(preRunDelayMs) || preRunDelayMs < 0) {
        return { error: "pre-run delay must be a non-negative number" };
      }
      await c.queue.send("runs", {
        kind: "occurrence",
        scheduledTime: scheduledTime.toISOString(),
        preRunDelayMs,
      });
      return { queued: true, scheduledTime, preRunDelayMs };
    },

    approve: async (c, approved: boolean) => {
      const pending = c.state.pendingApproval;
      if (!pending) return { error: "no run is waiting for approval" };
      if (c.state.approvalQueuedRunId === pending.runId) {
        return { queued: true, runId: pending.runId };
      }
      c.state.approvalQueuedRunId = pending.runId;
      await c.saveState({ immediate: true });
      try {
        await c.queue.send("runs", {
          kind: "approval",
          runId: pending.runId,
          approved,
        });
      } catch (error) {
        c.state.approvalQueuedRunId = null;
        await c.saveState({ immediate: true });
        throw error;
      }
      return { queued: true, runId: pending.runId };
    },

    listRuns: (c) => c.db.select().from(runs),

    eventsSince: async (c, cursor: number) => {
      const rows = await c.db.select().from(runEvents);
      return rows
        .filter((row) => row.cursor > cursor)
        .sort((a, b) => a.cursor - b.cursor);
    },

    inspect: async (c) => ({
      state: c.state,
      cron: await c.cron.list(),
      schedule: await c.schedule.list(),
    }),
  },
  run: async (c) => {
    for await (const message of c.queue.iter({ names: ["runs"] })) {
      await c.keepAwake(processQueuedRun(c, message.body));
    }
  },
});

async function processQueuedRun(
  c: SpikeActorContext,
  queued: QueuedRun,
): Promise<void> {
  if (queued.kind === "occurrence") {
    if (c.state.activeRunId || c.state.pendingApproval) {
      c.broadcast("runSkipped", {
        reason: c.state.activeRunId
          ? `run active: ${c.state.activeRunId}`
          : `awaiting approval: ${c.state.pendingApproval?.runId}`,
      });
      return;
    }
    c.state.runCounter += 1;
    const runId = `run-${c.state.runCounter}`;
    const scheduledTime = new Date(queued.scheduledTime);
    const startedAt = new Date();
    await c.db.insert(runs).values({
      id: runId,
      status: "running",
      scheduledTime: scheduledTime.toISOString(),
      startedAt: startedAt.toISOString(),
    });
    await executeRun(c, runId, scheduledTime, undefined, queued.preRunDelayMs);
    return;
  }

  const pending = c.state.pendingApproval;
  if (!pending || pending.runId !== queued.runId) {
    c.state.approvalQueuedRunId = null;
    await c.saveState({ immediate: true });
    return;
  }
  const checkpointRow = (
    await c.db
      .select()
      .from(runCheckpoints)
      .where(eq(runCheckpoints.runId, pending.runId))
  )[0];
  if (!checkpointRow) {
    c.state.approvalQueuedRunId = null;
    await c.saveState({ immediate: true });
    return;
  }
  const runRow = (
    await c.db.select().from(runs).where(eq(runs.id, pending.runId))
  )[0];
  const messages = (checkpointRow.messages as unknown[]).map((message) =>
    modelMessageSchema.parse(message),
  );
  const continuation: AgentRunRequest["continuation"] = {
    messages,
    startedAt: new Date(runRow?.startedAt ?? checkpointRow.updatedAt),
    approvals: pending.approvals.map(({ id }) => ({
      id,
      approved: queued.approved,
    })),
  };
  c.state.pendingApproval = null;
  c.state.approvalQueuedRunId = null;
  await c.saveState({ immediate: true });
  await c.db
    .update(runs)
    .set({ status: "running" })
    .where(eq(runs.id, pending.runId));
  await executeRun(
    c,
    pending.runId,
    new Date(runRow?.scheduledTime ?? checkpointRow.updatedAt),
    continuation,
  );
}

async function executeRun(
  c: SpikeActorContext,
  runId: string,
  scheduledTime: Date,
  continuation: AgentRunRequest["continuation"] | undefined,
  preRunDelayMs = 0,
): Promise<Record<string, unknown>> {
  c.state.activeRunId = runId;
  await c.saveState({ immediate: true });

  if (preRunDelayMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, preRunDelayMs);
      c.abortSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(c.abortSignal.reason ?? new Error("actor stopped"));
        },
        { once: true },
      );
    });
  }

  const task = await buildDigestTask(c.state.prompt, scheduledTime);
  const model = continuation ? resumeRunModel() : freshRunModel();
  const runner = new AiSdkAgentRunner(model, {
    pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8 },
  });
  const eventSink = createActorEventSink(c, runId);

  try {
    const result = await runTask(
      {
        runId,
        task,
        scheduledTime,
        connections: digestConnections,
        location: "local",
        eventSink,
        ...(continuation ? { continuation } : undefined),
      },
      { agent: runner, getToolSource },
    );
    await c.db
      .update(runs)
      .set({
        status: "succeeded",
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
        summary: result.result.summary,
        body: result.result.body.content,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsdMicros: result.usage.costUsdMicros ?? null,
      })
      .where(eq(runs.id, runId));
    await c.db.delete(runCheckpoints).where(eq(runCheckpoints.runId, runId));
    c.state.activeRunId = null;
    await c.saveState({ immediate: true });
    c.broadcast("runFinished", { runId, status: "succeeded" });
    return { runId, status: "succeeded", summary: result.result.summary };
  } catch (error) {
    if (error instanceof AgentRunApprovalRequiredError) {
      // Checkpoint boundary: the durable record must exist before this action
      // returns, so write the SQL row and force the throttled state save.
      const messages = JSON.parse(JSON.stringify(error.messages));
      const updatedAt = new Date().toISOString();
      await c.db
        .insert(runCheckpoints)
        .values({ runId, messages, updatedAt })
        .onConflictDoUpdate({
          target: runCheckpoints.runId,
          set: { messages, updatedAt },
        });
      await c.db
        .update(runs)
        .set({ status: "waiting_for_approval" })
        .where(eq(runs.id, runId));
      c.state.activeRunId = null;
      c.state.pendingApproval = {
        runId,
        approvals: error.approvals.map((approval) => ({
          id: approval.id,
          toolCallId: approval.toolCallId,
          toolName: approval.toolName,
          riskEffect: approval.riskEffect,
        })),
      };
      await c.saveState({ immediate: true });
      c.broadcast("runWaiting", { runId, approvals: c.state.pendingApproval });
      return {
        runId,
        status: "waiting_for_approval",
        approvals: c.state.pendingApproval.approvals,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    await c.db
      .update(runs)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: message,
      })
      .where(eq(runs.id, runId));
    c.state.activeRunId = null;
    await c.saveState({ immediate: true });
    c.broadcast("runFinished", { runId, status: "failed", error: message });
    return { runId, status: "failed", error: message };
  }
}

function createActorEventSink(
  c: SpikeActorContext,
  runId: string,
): AgentEventSink {
  let sequence = 0;
  let cursorBase: number | undefined;
  return {
    async append(
      payload: AgentEventPayloadV1,
      occurredAt: Date,
    ): Promise<AgentEventV1> {
      if (cursorBase === undefined) {
        const rows = await c.db.select().from(runEvents);
        cursorBase = rows.reduce((max, row) => Math.max(max, row.cursor), 0);
      }
      cursorBase += 1;
      const event = {
        ...payload,
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        runId,
        sequence,
        occurredAt: occurredAt.toISOString(),
      } as AgentEventV1;
      sequence += 1;
      await c.db.insert(runEvents).values({
        id: event.eventId as string,
        runId,
        sequence: event.sequence as number,
        cursor: cursorBase,
        type: payload.type,
        payload: payload as unknown as Record<string, unknown>,
        occurredAt: event.occurredAt as string,
      });
      c.broadcast("runEvent", event);
      return event;
    },
  };
}

export const registry = setup({ use: { taskActor } });
