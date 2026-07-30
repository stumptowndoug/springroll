import { eq } from "drizzle-orm";
import type { Connection, RunTaskResult, Task } from "../contracts.ts";
import {
  type AgentRunner,
  type RunTaskDependencies,
  runTask,
} from "../run-task.ts";
import type { ScheduledRunExecutor } from "../tick.ts";
import type { JsonObject, ToolSource } from "../tools.ts";
import type { AppDatabase } from "./database.ts";
import { connections, runEvents, runs, tasks, taskTools } from "./schema.ts";

export interface AgentRunExecutorOptions {
  readonly agent: AgentRunner;
  readonly getToolSource: (sourceId: string) => ToolSource | undefined;
  readonly location?: "local" | "hosted";
  readonly now?: () => Date;
}

export class AgentRunExecutor implements ScheduledRunExecutor {
  readonly #agent: AgentRunner;
  readonly #getToolSource: RunTaskDependencies["getToolSource"];
  readonly #location: "local" | "hosted";
  readonly #now: () => Date;

  constructor(
    private readonly db: AppDatabase,
    options: AgentRunExecutorOptions,
  ) {
    this.#agent = options.agent;
    this.#getToolSource = options.getToolSource;
    this.#location = options.location ?? "local";
    this.#now = options.now ?? (() => new Date());
  }

  async execute(
    runId: string,
    taskId: string,
    scheduledTime: Date,
  ): Promise<void> {
    const startedAt = this.#now();
    this.markRunning(runId, taskId, scheduledTime, startedAt);

    try {
      const request = this.loadRunRequest(taskId);
      const result = await runTask(
        {
          ...request,
          location: this.#location,
        },
        {
          agent: this.#agent,
          getToolSource: this.#getToolSource,
        },
      );

      this.persistSuccess(runId, result);
    } catch (error) {
      this.persistFailure(runId, startedAt, error);
    }
  }

  private markRunning(
    runId: string,
    taskId: string,
    scheduledTime: Date,
    startedAt: Date,
  ): void {
    this.db.transaction((transaction) => {
      transaction
        .update(runs)
        .set({ status: "running", startedAt })
        .where(eq(runs.id, runId))
        .run();
      transaction
        .insert(runEvents)
        .values({
          id: crypto.randomUUID(),
          runId,
          sequence: 0,
          type: "run_started",
          payload: {
            taskId,
            scheduledTime: scheduledTime.toISOString(),
          },
          createdAt: startedAt,
        })
        .run();
    });
  }

  private loadRunRequest(taskId: string): {
    readonly task: Task;
    readonly connections: readonly Connection[];
  } {
    const taskRow = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();

    if (!taskRow) {
      throw new Error(`Cannot execute missing task: ${taskId}`);
    }

    const toolRows = this.db
      .select()
      .from(taskTools)
      .where(eq(taskTools.taskId, taskId))
      .all();
    const connectionIds = new Set(toolRows.map((tool) => tool.connectionId));
    const taskConnections = this.db
      .select()
      .from(connections)
      .all()
      .filter((connection) => connectionIds.has(connection.id));

    return {
      task: {
        id: taskRow.id,
        prompt: taskRow.prompt,
        enabled: taskRow.enabled,
        nextRunAt: taskRow.nextRunAt,
        catchUpPolicy: taskRow.catchUpPolicy,
        tools: toolRows.map((tool) => ({
          sourceId: tool.sourceId,
          connectionId: tool.connectionId,
          name: tool.name,
          inputSchemaHash: tool.inputSchemaHash,
          risk: {
            effect: tool.riskEffect,
            openWorld: tool.riskOpenWorld,
            idempotent: tool.riskIdempotent,
          },
          approval: tool.approval,
        })),
      },
      connections: taskConnections.map((connection) => ({
        id: connection.id,
        sourceId: connection.sourceId,
        credentialRef: connection.credentialRef,
        availableIn: connection.availableIn,
      })),
    };
  }

  private persistSuccess(runId: string, result: RunTaskResult): void {
    const durationMs = Math.max(
      0,
      result.finishedAt.getTime() - result.startedAt.getTime(),
    );
    const toolEvents = result.toolCalls.map((toolCall, index) => ({
      id: crypto.randomUUID(),
      runId,
      sequence: index + 1,
      type: "tool_call" as const,
      payload: toolCallPayload(toolCall),
      createdAt: toolCall.finishedAt,
    }));
    const outputSequence = toolEvents.length + 1;

    this.db.transaction((transaction) => {
      transaction
        .insert(runEvents)
        .values([
          ...toolEvents,
          {
            id: crypto.randomUUID(),
            runId,
            sequence: outputSequence,
            type: "agent_output",
            payload: {
              summary: result.transcript.summary,
              body: result.transcript.body,
            },
            createdAt: result.finishedAt,
          },
          {
            id: crypto.randomUUID(),
            runId,
            sequence: outputSequence + 1,
            type: "run_succeeded",
            payload: {},
            createdAt: result.finishedAt,
          },
        ])
        .run();
      transaction
        .update(runs)
        .set({
          status: "succeeded",
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          durationMs,
          transcriptSummary: result.transcript.summary,
          transcriptBody: result.transcript.body,
          modelProvider: result.usage.provider,
          modelId: result.usage.modelId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          costUsdMicros: result.usage.costUsdMicros,
          error: null,
        })
        .where(eq(runs.id, runId))
        .run();
    });
  }

  private persistFailure(runId: string, startedAt: Date, error: unknown): void {
    const finishedAt = this.#now();
    const message = errorMessage(error);

    this.db.transaction((transaction) => {
      transaction
        .insert(runEvents)
        .values({
          id: crypto.randomUUID(),
          runId,
          sequence: 1,
          type: "run_failed",
          payload: { error: message },
          createdAt: finishedAt,
        })
        .run();
      transaction
        .update(runs)
        .set({
          status: "failed",
          finishedAt,
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          error: message,
        })
        .where(eq(runs.id, runId))
        .run();
    });
  }
}

function toolCallPayload(
  toolCall: RunTaskResult["toolCalls"][number],
): JsonObject {
  return {
    toolName: toolCall.toolName,
    input: toolCall.input,
    status: toolCall.status,
    startedAt: toolCall.startedAt.toISOString(),
    finishedAt: toolCall.finishedAt.toISOString(),
    ...(toolCall.outputSummary
      ? { outputSummary: toolCall.outputSummary }
      : undefined),
    ...(toolCall.error ? { error: toolCall.error } : undefined),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
