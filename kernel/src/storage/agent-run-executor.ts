import { eq } from "drizzle-orm";
import type { Connection, RunTaskResult, Task } from "../contracts.ts";
import { classifyFailure } from "../failures.ts";
import {
  type AgentRunner,
  type RunTaskDependencies,
  runTask,
} from "../run-task.ts";
import type { ScheduledRunExecutor } from "../tick.ts";
import type { JsonObject, ToolSource } from "../tools.ts";
import type { AppDatabase } from "./database.ts";
import { connections, runEvents, runs, tasks, taskTools } from "./schema.ts";
import { SqliteAgentEventSink } from "./sqlite-agent-event-sink.ts";

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
      const eventSink = new SqliteAgentEventSink(this.db, runId);
      const result = await runTask(
        {
          ...request,
          runId,
          location: this.#location,
          eventSink,
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
        ...(taskRow.modelProviderId && taskRow.modelId
          ? {
              modelSelection: {
                providerId: taskRow.modelProviderId,
                modelId: taskRow.modelId,
              },
            }
          : undefined),
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
        config: connection.config,
      })),
    };
  }

  private persistSuccess(runId: string, result: RunTaskResult): void {
    const durationMs = Math.max(
      0,
      result.finishedAt.getTime() - result.startedAt.getTime(),
    );
    const existingEvents = this.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .all();
    const hasCanonicalToolEvents = existingEvents.some(
      (event) =>
        event.type === "tool_call" && event.payload.schemaVersion === 1,
    );
    const hasCanonicalUsageEvents = existingEvents.some(
      (event) => event.type === "usage" && event.payload.schemaVersion === 1,
    );
    const hasModelSelectionEvent = existingEvents.some(
      (event) =>
        event.type === "model_selection" && event.payload.schemaVersion === 1,
    );
    const firstSequence =
      Math.max(-1, ...existingEvents.map((event) => event.sequence)) + 1;
    const toolEvents = (hasCanonicalToolEvents ? [] : result.toolCalls).map(
      (toolCall, index) => ({
        id: crypto.randomUUID(),
        runId,
        sequence: firstSequence + index,
        type: "tool_call" as const,
        payload: toolCallPayload(toolCall),
        createdAt: toolCall.finishedAt,
      }),
    );
    const outputSequence = firstSequence + toolEvents.length;

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
              result: result.result,
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
          transcriptSummary: result.result.summary,
          transcriptBody: result.result.body.content,
          resultJson: result.result,
          ...(!hasModelSelectionEvent
            ? {
                modelProvider: result.usage.provider,
                modelId: result.usage.modelId,
                modelBilling: result.usage.billing,
              }
            : undefined),
          ...(!hasCanonicalUsageEvents
            ? {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                reasoningTokens: result.usage.reasoningTokens,
                cachedInputTokens: result.usage.cachedInputTokens,
                totalTokens: result.usage.totalTokens,
                costUsdMicros: result.usage.costUsdMicros,
                actualCostUsdMicros: result.usage.actualCostUsdMicros,
                estimatedCostUsdMicros: result.usage.estimatedCostUsdMicros,
                costSource: result.usage.costSource,
                webSearchRequests: result.usage.webSearchRequests,
              }
            : undefined),
          failureCategory: null,
          error: null,
        })
        .where(eq(runs.id, runId))
        .run();
    });
  }

  private persistFailure(runId: string, startedAt: Date, error: unknown): void {
    const finishedAt = this.#now();
    const message = errorMessage(error);
    const failure = classifyFailure(error);

    const latestSequence =
      this.db
        .select({ sequence: runEvents.sequence })
        .from(runEvents)
        .where(eq(runEvents.runId, runId))
        .all()
        .reduce((latest, event) => Math.max(latest, event.sequence), -1) + 1;

    this.db.transaction((transaction) => {
      transaction
        .insert(runEvents)
        .values({
          id: crypto.randomUUID(),
          runId,
          sequence: latestSequence,
          type: "run_failed",
          payload: {
            error: message,
            category: failure.category,
            retryable: failure.retryable,
          },
          createdAt: finishedAt,
        })
        .run();
      transaction
        .update(runs)
        .set({
          status: "failed",
          finishedAt,
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          failureCategory: failure.category,
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
