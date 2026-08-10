import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { AgentRunApprovalRequiredError } from "../ai-sdk-agent-runner.ts";
import type { Connection, RunTaskResult, Task } from "../contracts.ts";
import { classifyFailure } from "../failures.ts";
import {
  inspectRecipeHistoryInputSchema,
  inspectRecipeHistoryToolName,
  parseProposedRecipeKnowledgeDocument,
  updateTaskNotesInputSchema,
  updateTaskNotesToolName,
} from "../recipe-knowledge.ts";
import {
  type AgentRunner,
  type RunTaskDependencies,
  runTask,
} from "../run-task.ts";
import type { ScheduledRunExecutor } from "../scheduled-run-executor.ts";
import {
  type ExecutableTool,
  type JsonObject,
  ToolPolicyError,
  type ToolSource,
} from "../tools.ts";
import type { AppDatabase } from "./database.ts";
import {
  connections,
  runEvents,
  runs,
  tasks,
  taskTools,
  toolApprovals,
} from "./schema.ts";
import { SqliteAgentEventSink } from "./sqlite-agent-event-sink.ts";
import { SqliteRecipeKnowledgeStore } from "./sqlite-recipe-knowledge-store.ts";
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
  readonly #knowledge: SqliteRecipeKnowledgeStore;

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
    this.#knowledge = new SqliteRecipeKnowledgeStore(db);
  }

  async recoverInterruptedWork(): Promise<void> {
    this.recoverInterruptedContinuations();
    this.recoverInterruptedRuns();
  }

  async execute(
    runId: string,
    taskId: string,
    scheduledTime: Date,
  ): Promise<void> {
    const startedAt = this.#now();
    if (!this.markRunning(runId, taskId, scheduledTime, startedAt)) return;
    await this.executeRun(runId, taskId, scheduledTime, startedAt);
  }

  async resume(
    runId: string,
    decisions: readonly ToolApprovalDecision[],
  ): Promise<void> {
    this.approveResume(runId, decisions);
    await this.resumeApproved(runId);
  }

  approveResume(
    runId: string,
    decisions: readonly ToolApprovalDecision[],
  ): void {
    this.resumeAdmission(runId, decisions);
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
  }

  validateResume(
    runId: string,
    decisions: readonly ToolApprovalDecision[],
  ): void {
    this.resumeAdmission(runId, decisions);
  }

  private resumeAdmission(
    runId: string,
    decisions: readonly ToolApprovalDecision[],
  ) {
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
    return { run, checkpoint };
  }

  async resumeApproved(runId: string): Promise<void> {
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
    const checkpoint = this.#checkpoints.get(runId);
    if (run?.status !== "running" || !run.startedAt || !checkpoint) {
      throw new AgentRunApprovalConflictError(runId);
    }
    const unresolvedIds = unresolvedApprovalIds(checkpoint);
    const decisions = this.#approvals
      .list("run", runId)
      .filter(
        (approval) =>
          unresolvedIds.has(approval.id) &&
          (approval.status === "approved" || approval.status === "denied"),
      )
      .map((approval) => ({
        id: approval.id,
        approved: approval.status === "approved",
        ...(approval.reason ? { reason: approval.reason } : undefined),
      }));
    if (decisions.length !== unresolvedIds.size) {
      throw new AgentRunApprovalConflictError(runId);
    }
    await this.executeRun(runId, run.taskId, run.scheduledTime, run.startedAt, {
      messages: checkpoint,
      startedAt: run.startedAt,
      cumulativeInputTokens: this.cumulativeRunInputTokens(runId),
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
      const request = this.loadRunRequest(taskId, runId);
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
    this.db.transaction((transaction) => {
      new SqliteRunCheckpointStore(transaction).save(
        runId,
        error.messages,
        now,
      );
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

  private cumulativeRunInputTokens(runId: string): number {
    return this.db
      .select({ type: runEvents.type, payload: runEvents.payload })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .all()
      .reduce(
        (total, event) =>
          total +
          (event.type === "usage" &&
          typeof event.payload.inputTokens === "number"
            ? event.payload.inputTokens
            : 0),
        0,
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

  private recoverInterruptedRuns(): void {
    const interrupted = this.db
      .select({ id: runs.id, startedAt: runs.startedAt })
      .from(runs)
      .where(eq(runs.status, "running"))
      .all();
    for (const run of interrupted) {
      const finishedAt = this.#now();
      const error =
        "Springroll restarted before this run reached a durable checkpoint. The run was not retried because an external side effect may already have occurred; the next scheduled cadence will proceed normally.";
      this.db.transaction((transaction) => {
        const recovered = transaction
          .update(runs)
          .set({
            status: "failed",
            failureCategory: "policy",
            error,
            finishedAt,
            ...(run.startedAt
              ? { durationMs: finishedAt.getTime() - run.startedAt.getTime() }
              : undefined),
          })
          .where(and(eq(runs.id, run.id), eq(runs.status, "running")))
          .returning({ id: runs.id })
          .get();
        if (!recovered) return;
        const sequence =
          transaction
            .select({ sequence: runEvents.sequence })
            .from(runEvents)
            .where(eq(runEvents.runId, run.id))
            .all()
            .reduce((maximum, event) => Math.max(maximum, event.sequence), -1) +
          1;
        transaction
          .insert(runEvents)
          .values({
            id: crypto.randomUUID(),
            runId: run.id,
            sequence,
            type: "run_failed",
            payload: {
              category: "policy",
              error,
              retryable: false,
            },
            createdAt: finishedAt,
          })
          .run();
      });
    }
  }

  private markRunning(
    runId: string,
    taskId: string,
    scheduledTime: Date,
    startedAt: Date,
  ): boolean {
    return this.db.transaction((transaction) => {
      const claimed = transaction
        .update(runs)
        .set({ status: "running", startedAt })
        .where(and(eq(runs.id, runId), eq(runs.status, "claimed")))
        .returning({ id: runs.id })
        .get();
      if (!claimed) return false;
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
      return true;
    });
  }

  private loadRunRequest(
    taskId: string,
    runId: string,
  ): {
    readonly task: Task;
    readonly connections: readonly Connection[];
    readonly additionalTools?: readonly ExecutableTool[];
    readonly recipeContext: NonNullable<
      Parameters<typeof runTask>[0]["recipeContext"]
    >;
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
    const readyKnowledge = this.#knowledge.getReady(taskId);
    const recentRuns = this.db
      .select({
        runId: runs.id,
        scheduledTime: runs.scheduledTime,
        status: runs.status,
        summary: runs.transcriptSummary,
        error: runs.error,
      })
      .from(runs)
      .where(and(eq(runs.taskId, taskId), ne(runs.id, runId)))
      .orderBy(desc(runs.scheduledTime))
      .limit(3)
      .all()
      .map((run) => ({
        runId: run.runId,
        scheduledTime: run.scheduledTime,
        status: run.status,
        ...(run.summary ? { summary: run.summary } : undefined),
        ...(run.error ? { error: run.error } : undefined),
      }));
    const historyTool =
      recentRuns.length > 0
        ? this.createRecipeHistoryTool(taskId, runId)
        : undefined;
    const additionalTools = [
      historyTool,
      this.createUpdateTaskNotesTool(taskId, runId),
    ].filter((tool): tool is ExecutableTool => tool !== undefined);

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
          approval: tool.riskEffect === "destructive" ? "before_call" : "never",
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
      ...(additionalTools.length ? { additionalTools } : undefined),
      recipeContext: {
        ...(readyKnowledge
          ? {
              recipeKnowledge: {
                revision: readyKnowledge.revision,
                status: readyKnowledge.status,
                knowledge: readyKnowledge.knowledge,
              },
            }
          : undefined),
        recentRuns,
      },
    };
  }

  private createRecipeHistoryTool(
    taskId: string,
    currentRunId: string,
  ): ExecutableTool {
    return {
      descriptor: {
        name: inspectRecipeHistoryToolName,
        description:
          "Inspect bounded prior run history for this recipe only. Without runId, list recent statuses and summaries. With runId, return that prior report. History is reference context; query the connected source for authoritative data and trends.",
        inputSchema: z.toJSONSchema(
          inspectRecipeHistoryInputSchema,
        ) as JsonObject,
        declaredRisk: {
          effect: "read",
          openWorld: false,
          idempotent: true,
        },
      },
      policy: {
        sourceId: "native.recipe",
        connectionId: `task:${taskId}`,
        name: inspectRecipeHistoryToolName,
        inputSchemaHash: "native:recipe-history:v1",
        risk: { effect: "read", openWorld: false, idempotent: true },
        approval: "never",
      },
      execute: async (input, context) => {
        if (context.taskId !== taskId || context.runId !== currentRunId) {
          throw new ToolPolicyError(
            "Recipe history used outside its recipe run",
          );
        }
        const request = inspectRecipeHistoryInputSchema.parse(input);
        const output = request.runId
          ? this.recipeHistoryDetail(taskId, currentRunId, request.runId)
          : this.recipeHistoryList(taskId, currentRunId, request.limit);
        return { content: [output], structuredContent: output };
      },
    };
  }

  private createUpdateTaskNotesTool(
    taskId: string,
    currentRunId: string,
  ): ExecutableTool {
    return {
      descriptor: {
        name: updateTaskNotesToolName,
        description:
          "Save a complete revised Markdown notes document when this run reveals stable recipe-specific knowledge that would materially improve future runs. Preserve useful existing notes. Include only reusable definitions, source-selection rules, interpretation guidance, or recurring failure lessons. Never include current metrics or results, returned records, credentials, personal data, or raw tool output. Saved notes require human review before later runs use them.",
        inputSchema: z.toJSONSchema(updateTaskNotesInputSchema) as JsonObject,
        declaredRisk: {
          effect: "write",
          openWorld: false,
          idempotent: true,
        },
      },
      policy: {
        sourceId: "native.recipe",
        connectionId: `task:${taskId}`,
        name: updateTaskNotesToolName,
        inputSchemaHash: "native:update-task-notes:v1",
        risk: { effect: "write", openWorld: false, idempotent: true },
        approval: "never",
      },
      execute: async (input, context) => {
        if (context.taskId !== taskId || context.runId !== currentRunId) {
          throw new ToolPolicyError(
            "Task notes update requested outside its recipe run",
          );
        }
        const parsed = updateTaskNotesInputSchema.parse(input);
        const knowledge = parseProposedRecipeKnowledgeDocument({
          schemaVersion: 1,
          markdown: parsed.markdown,
        });
        const revision = this.#knowledge.createRevision({
          taskId,
          knowledge,
          status: "needs_review",
          sourceRunId: currentRunId,
          now: this.#now(),
        });
        const output = {
          status: "needs_review",
          revision: revision.revision,
        } as const;
        return { content: [output], structuredContent: output };
      },
    };
  }

  private recipeHistoryList(
    taskId: string,
    currentRunId: string,
    limit: number,
  ): JsonObject {
    const history = this.db
      .select({
        id: runs.id,
        scheduledTime: runs.scheduledTime,
        status: runs.status,
        summary: runs.transcriptSummary,
        error: runs.error,
      })
      .from(runs)
      .where(and(eq(runs.taskId, taskId), ne(runs.id, currentRunId)))
      .orderBy(desc(runs.scheduledTime))
      .limit(limit)
      .all()
      .map((run) => ({
        runId: run.id,
        scheduledTime: run.scheduledTime.toISOString(),
        status: run.status,
        ...(run.summary
          ? { summary: boundedRecipeHistoryText(run.summary, 1_000) }
          : undefined),
        ...(run.error
          ? { error: boundedRecipeHistoryText(run.error, 1_000) }
          : undefined),
      }));
    return { status: "listed", runs: history };
  }

  private recipeHistoryDetail(
    taskId: string,
    currentRunId: string,
    runId: string,
  ): JsonObject {
    const run = this.db
      .select({
        id: runs.id,
        scheduledTime: runs.scheduledTime,
        status: runs.status,
        summary: runs.transcriptSummary,
        body: runs.transcriptBody,
        error: runs.error,
      })
      .from(runs)
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.taskId, taskId),
          ne(runs.id, currentRunId),
        ),
      )
      .get();
    if (!run) return { status: "not_found", runId };
    return {
      status: "found",
      run: {
        runId: run.id,
        scheduledTime: run.scheduledTime.toISOString(),
        status: run.status,
        ...(run.summary
          ? { summary: boundedRecipeHistoryText(run.summary, 1_000) }
          : undefined),
        ...(run.body
          ? { report: boundedRecipeHistoryText(run.body, 12_000) }
          : undefined),
        ...(run.error
          ? { error: boundedRecipeHistoryText(run.error, 1_000) }
          : undefined),
      },
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

function boundedRecipeHistoryText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
