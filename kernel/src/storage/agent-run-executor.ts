import { and, eq } from "drizzle-orm";
import { AgentRunApprovalRequiredError } from "../ai-sdk-agent-runner.ts";
import type { Connection, RunTaskResult, Task } from "../contracts.ts";
import { classifyFailure } from "../failures.ts";
import {
  type AgentRunner,
  type RunTaskDependencies,
  runTask,
} from "../run-task.ts";
import type { ScheduledRunExecutor } from "../tick.ts";
import { type JsonObject, ToolPolicyError, type ToolSource } from "../tools.ts";
import type { AppDatabase } from "./database.ts";
import {
  connections,
  runCheckpoints,
  runEvents,
  runs,
  tasks,
  taskTools,
  toolApprovals,
} from "./schema.ts";
import { SqliteAgentEventSink } from "./sqlite-agent-event-sink.ts";
import { SqliteRunCheckpointStore } from "./sqlite-run-checkpoint-store.ts";
import {
  SqliteToolApprovalStore,
  type ToolApprovalDecision,
} from "./sqlite-tool-approval-store.ts";

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
  readonly #approvals: SqliteToolApprovalStore;
  readonly #checkpoints: SqliteRunCheckpointStore;

  constructor(
    private readonly db: AppDatabase,
    options: AgentRunExecutorOptions,
  ) {
    this.#agent = options.agent;
    this.#getToolSource = options.getToolSource;
    this.#location = options.location ?? "local";
    this.#now = options.now ?? (() => new Date());
    this.#approvals = new SqliteToolApprovalStore(db);
    this.#checkpoints = new SqliteRunCheckpointStore(db);
    this.recoverInterruptedContinuations();
  }

  async execute(
    runId: string,
    taskId: string,
    scheduledTime: Date,
  ): Promise<void> {
    const startedAt = this.#now();
    this.markRunning(runId, taskId, scheduledTime, startedAt);
    await this.executeRun(runId, taskId, scheduledTime, startedAt);
  }

  async resume(
    runId: string,
    decisions: readonly ToolApprovalDecision[],
  ): Promise<void> {
    const run = this.db
      .select({
        taskId: runs.taskId,
        scheduledTime: runs.scheduledTime,
        startedAt: runs.startedAt,
        status: runs.status,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    if (!run) throw new AgentRunNotFoundError(runId);
    if (run.status !== "waiting_for_approval") {
      throw new AgentRunApprovalConflictError(runId);
    }
    const checkpoint = this.#checkpoints.get(runId);
    if (!checkpoint || !run.startedAt) {
      throw new AgentRunApprovalConflictError(runId);
    }
    const unresolvedIds = unresolvedApprovalIds(checkpoint);
    const pending = this.#approvals
      .list("run", runId)
      .filter((approval) => unresolvedIds.has(approval.id));
    const decisionIds = new Set(decisions.map(({ id }) => id));
    if (
      pending.length !== decisions.length ||
      pending.some(({ id }) => !decisionIds.has(id))
    ) {
      throw new AgentRunApprovalConflictError(runId);
    }
    try {
      this.#approvals.decide("run", runId, decisions, this.#now());
    } catch {
      throw new AgentRunApprovalConflictError(runId);
    }
    this.db
      .update(runs)
      .set({ status: "running", error: null })
      .where(eq(runs.id, runId))
      .run();
    await this.executeRun(runId, run.taskId, run.scheduledTime, run.startedAt, {
      messages: checkpoint,
      startedAt: run.startedAt,
      approvals: decisions,
    });
  }

  private async executeRun(
    runId: string,
    taskId: string,
    scheduledTime: Date,
    startedAt: Date,
    continuation?: Parameters<typeof runTask>[0]["continuation"],
  ): Promise<void> {
    try {
      const request = this.loadRunRequest(taskId);
      const eventSink = new SqliteAgentEventSink(this.db, runId);
      const result = await runTask(
        {
          ...request,
          runId,
          scheduledTime,
          location: this.#location,
          eventSink,
          ...(continuation ? { continuation } : undefined),
          approvalExecution: {
            starting: (toolCallId) => {
              const approval = this.runApproval(runId, toolCallId, "approved");
              if (!approval) {
                throw new ToolPolicyError(
                  `Approved run tool call is not in the ledger: ${toolCallId}`,
                );
              }
              this.#approvals.markExecuting(approval.id, this.#now());
            },
            finished: (toolCallId, status) => {
              const approval = this.runApproval(runId, toolCallId, "executing");
              if (!approval) {
                throw new ToolPolicyError(
                  `Executing run tool call is not in the ledger: ${toolCallId}`,
                );
              }
              this.#approvals.complete(approval.id, {
                status,
                outcome: {
                  state:
                    status === "succeeded"
                      ? "output-available"
                      : "output-error",
                },
                now: this.#now(),
              });
            },
          },
        },
        {
          agent: this.#agent,
          getToolSource: this.#getToolSource,
        },
      );

      this.persistSuccess(runId, result);
    } catch (error) {
      if (error instanceof AgentRunApprovalRequiredError) {
        this.persistWaiting(runId, error);
      } else {
        this.persistFailure(runId, startedAt, error);
      }
    }
  }

  private persistWaiting(
    runId: string,
    error: AgentRunApprovalRequiredError,
  ): void {
    const now = this.#now();
    const messages = JSON.parse(JSON.stringify(error.messages)) as JsonObject[];
    this.db.transaction((transaction) => {
      transaction
        .insert(runCheckpoints)
        .values({ runId, messages, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: runCheckpoints.runId,
          set: { messages, updatedAt: now },
        })
        .run();
      for (const approval of error.approvals) {
        transaction
          .insert(toolApprovals)
          .values({
            id: approval.id,
            contextKind: "run",
            contextId: runId,
            toolCallId: approval.toolCallId,
            toolName: approval.toolName,
            input: approval.input,
            riskEffect: approval.riskEffect,
            status: "pending",
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      transaction
        .update(runs)
        .set({
          status: "waiting_for_approval",
          finishedAt: null,
          durationMs: null,
          failureCategory: null,
          error: null,
        })
        .where(eq(runs.id, runId))
        .run();
    });
  }

  private runApproval(
    runId: string,
    toolCallId: string,
    status: "approved" | "executing",
  ) {
    return this.#approvals
      .list("run", runId)
      .find(
        (approval) =>
          approval.toolCallId === toolCallId && approval.status === status,
      );
  }

  private recoverInterruptedContinuations(): void {
    const active = this.db
      .select({ runId: toolApprovals.contextId })
      .from(toolApprovals)
      .where(
        and(
          eq(toolApprovals.contextKind, "run"),
          eq(toolApprovals.status, "executing"),
        ),
      )
      .all();
    if (active.length > 0) {
      this.#approvals.recoverExecuting(this.#now());
    }

    const checkpointRuns = this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.status, "running"))
      .all()
      .filter(({ id }) => this.#checkpoints.get(id) !== undefined);
    const ambiguousIds = new Set(active.map(({ runId }) => runId));
    for (const { id } of checkpointRuns) {
      const checkpoint = this.#checkpoints.get(id) ?? [];
      const unresolvedIds = unresolvedApprovalIds(checkpoint);
      const approvals = this.#approvals.list("run", id);
      const completedCall = approvals.some(
        ({ id: approvalId, status }) =>
          unresolvedIds.has(approvalId) &&
          (status === "succeeded" || status === "failed"),
      );
      if (ambiguousIds.has(id) || completedCall) {
        const message = ambiguousIds.has(id)
          ? "Springroll restarted after an approved tool call began. Verify remote state before retrying."
          : "An approved tool call finished, but Springroll restarted before the run response completed. The tool was not retried.";
        this.db
          .update(runs)
          .set({
            status: "failed",
            failureCategory: "policy",
            error: message,
            finishedAt: this.#now(),
          })
          .where(eq(runs.id, id))
          .run();
        this.#checkpoints.delete(id);
      } else {
        this.db
          .update(runs)
          .set({ status: "waiting_for_approval" })
          .where(eq(runs.id, id))
          .run();
      }
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
        scheduleTimezone: taskRow.scheduleTimezone,
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
        ...(connection.manifestId
          ? { manifestId: connection.manifestId }
          : undefined),
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
    this.#checkpoints.delete(runId);
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
    this.#checkpoints.delete(runId);
  }
}

export class AgentRunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Run not found: ${runId}`);
  }
}

export class AgentRunApprovalConflictError extends Error {
  constructor(readonly runId: string) {
    super(`Run approval is no longer pending: ${runId}`);
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

function unresolvedApprovalIds(
  messages: readonly {
    readonly role: string;
    readonly content: unknown;
  }[],
): ReadonlySet<string> {
  const requested = new Set<string>();
  const responded = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      const value = part as {
        readonly type?: unknown;
        readonly approvalId?: unknown;
      };
      if (typeof value.approvalId !== "string") continue;
      if (value.type === "tool-approval-request") {
        requested.add(value.approvalId);
      } else if (value.type === "tool-approval-response") {
        responded.add(value.approvalId);
      }
    }
  }
  return new Set([...requested].filter((id) => !responded.has(id)));
}
