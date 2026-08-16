import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  max,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  type AssistantWorkflowKind,
  type AssistantWorkflowStatus,
  assistantWorkflowKindSchema,
  assistantWorkflowStatusSchema,
  type ChatMessageRole,
  type ChatSessionContext,
  type ChatSessionEntryMode,
  type ChatSubjectReference,
  type ChatTurnStatus,
  chatMessageRoleSchema,
  chatSessionContextKey,
  chatTurnStatusSchema,
  isTerminalAssistantWorkflowStatus,
  isTerminalChatTurnStatus,
  isValidAssistantWorkflowTransition,
  isValidChatTurnTransition,
  parseChatSessionContext,
  parseDurableChatContent,
} from "../assistant.ts";
import type { TaskModelSelection } from "../contracts.ts";
import {
  toDurableChatMetadata,
  toDurableChatParts,
} from "../durable-chat-persistence.ts";
import type { JsonObject } from "../tools.ts";
import type { AppDatabase } from "./database.ts";
import {
  type AssistantWorkflowRow,
  assistantWorkflows,
  type ChatMessageRow,
  type ChatSessionRow,
  type ChatToolCallRow,
  type ChatTurnRow,
  chatMessages,
  chatSessions,
  chatToolCalls,
  chatTurns,
  modelCalls,
  toolApprovals,
} from "./schema.ts";

export interface CreateChatSessionInput {
  readonly id?: string;
  readonly title?: string;
  readonly context?: ChatSessionContext;
  readonly modelSelection?: TaskModelSelection | null;
  readonly now?: Date;
}

export interface CreateOrResumeChatSessionInput {
  readonly title?: string;
  readonly context: ChatSessionContext;
  readonly mode?: ChatSessionEntryMode;
  readonly modelSelection?: TaskModelSelection | null;
  readonly now?: Date;
}

export interface AppendChatMessageInput {
  readonly id?: string;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly role: ChatMessageRole;
  readonly parts: readonly JsonObject[];
  readonly metadata?: JsonObject;
  readonly createdAt?: Date;
}

export interface ReplaceChatMessageInput {
  readonly parts: readonly JsonObject[];
  readonly metadata?: JsonObject;
  readonly now?: Date;
}

export interface RecordAssistantWorkflowInput {
  readonly id?: string;
  readonly sessionId: string;
  readonly sourceMessageId: string;
  readonly sourceToolCallId: string;
  readonly kind: AssistantWorkflowKind;
  readonly payload: JsonObject;
  readonly now?: Date;
}

export interface UpdateAssistantWorkflowInput {
  readonly status: AssistantWorkflowStatus;
  readonly subject?: ChatSubjectReference;
  readonly outcome?: JsonObject;
  readonly error?: string | null;
  readonly now?: Date;
}

export interface ChatUsageSummary {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cachedInputTokens: number;
  readonly totalTokens: number;
  readonly actualCostUsdMicros: number;
  readonly estimatedCostUsdMicros: number;
  readonly webSearchRequests: number;
  readonly providerToolCalls: number;
}

export class SqliteChatStore {
  constructor(private readonly db: AppDatabase) {}

  createSession(input: CreateChatSessionInput = {}): ChatSessionRow {
    const id = input.id ?? crypto.randomUUID();
    const now = input.now ?? new Date();
    const context = input.context
      ? parseChatSessionContext(input.context)
      : undefined;
    this.db
      .insert(chatSessions)
      .values({
        id,
        title: optionalText(input.title),
        status: "active",
        ...(context
          ? { context, contextKey: chatSessionContextKey(context) }
          : undefined),
        ...sessionModelColumns(input.modelSelection),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.requireSession(id);
  }

  createOrResumeSession(input: CreateOrResumeChatSessionInput): ChatSessionRow {
    const context = parseChatSessionContext(input.context);
    const contextKey = chatSessionContextKey(context);
    if ((input.mode ?? "resume") === "resume" && context.subjects.length > 0) {
      const existing = this.db
        .select()
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.status, "active"),
            eq(chatSessions.contextKey, contextKey),
          ),
        )
        .orderBy(desc(chatSessions.updatedAt))
        .get();
      if (existing) {
        return input.modelSelection === undefined
          ? existing
          : this.updateSessionModel(
              existing.id,
              input.modelSelection,
              input.now,
            );
      }
    }
    return this.createSession({
      ...(input.title ? { title: input.title } : undefined),
      context,
      ...(input.modelSelection === undefined
        ? undefined
        : { modelSelection: input.modelSelection }),
      ...(input.now ? { now: input.now } : undefined),
    });
  }

  getSession(id: string): ChatSessionRow | undefined {
    return this.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id))
      .get();
  }

  listSessions(includeArchived = false): readonly ChatSessionRow[] {
    const query = this.db.select().from(chatSessions);
    return (
      includeArchived ? query : query.where(eq(chatSessions.status, "active"))
    )
      .orderBy(desc(chatSessions.updatedAt))
      .all();
  }

  renameSession(id: string, title: string, now = new Date()): ChatSessionRow {
    const normalized = title.trim();
    if (!normalized) throw new TypeError("Chat session title is required");
    if (normalized.length > 200) {
      throw new RangeError(
        "Chat session title must be 200 characters or fewer",
      );
    }
    this.requireSession(id);
    this.db
      .update(chatSessions)
      .set({ title: normalized, updatedAt: now })
      .where(eq(chatSessions.id, id))
      .run();
    return this.requireSession(id);
  }

  updateSessionModel(
    id: string,
    selection: TaskModelSelection | null,
    now = new Date(),
  ): ChatSessionRow {
    this.requireSession(id);
    this.db
      .update(chatSessions)
      .set({
        ...sessionModelColumns(selection),
        updatedAt: now,
      })
      .where(eq(chatSessions.id, id))
      .run();
    return this.requireSession(id);
  }

  updateSessionContext(
    id: string,
    contextValue: ChatSessionContext,
    now = new Date(),
  ): ChatSessionRow {
    const session = this.requireSession(id);
    if (session.status !== "active") {
      throw new Error(`Chat session is archived: ${id}`);
    }
    const context = parseChatSessionContext(contextValue);
    this.db
      .update(chatSessions)
      .set({
        context,
        contextKey: chatSessionContextKey(context),
        updatedAt: now,
      })
      .where(eq(chatSessions.id, id))
      .run();
    return this.requireSession(id);
  }

  archiveSession(id: string, now = new Date()): ChatSessionRow {
    this.db.transaction((tx) => {
      const session = tx
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, id))
        .get();
      if (!session) throw new Error(`Unknown chat session: ${id}`);
      if (session.activeTurnId) {
        tx.update(chatTurns)
          .set({ status: "cancelled", finishedAt: now, updatedAt: now })
          .where(eq(chatTurns.id, session.activeTurnId))
          .run();
      }
      tx.update(chatSessions)
        .set({ status: "archived", activeTurnId: null, updatedAt: now })
        .where(eq(chatSessions.id, id))
        .run();
    });
    return this.requireSession(id);
  }

  restoreSession(id: string, now = new Date()): ChatSessionRow {
    const session = this.requireSession(id);
    if (session.activeTurnId) {
      throw new Error(`Cannot restore a chat with an active turn: ${id}`);
    }
    this.db
      .update(chatSessions)
      .set({ status: "active", updatedAt: now })
      .where(eq(chatSessions.id, id))
      .run();
    return this.requireSession(id);
  }

  deleteSession(id: string): void {
    this.db.transaction((tx) => {
      const session = tx
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, id))
        .get();
      if (!session) throw new Error(`Unknown chat session: ${id}`);
      if (session.status !== "archived" || session.activeTurnId) {
        throw new Error(`Chat session must be archived before deletion: ${id}`);
      }
      for (const turn of tx
        .select({ id: chatTurns.id })
        .from(chatTurns)
        .where(eq(chatTurns.sessionId, id))
        .all()) {
        tx.delete(modelCalls)
          .where(
            and(
              eq(modelCalls.contextKind, "chat"),
              eq(modelCalls.contextId, turn.id),
            ),
          )
          .run();
        tx.delete(toolApprovals)
          .where(
            and(
              eq(toolApprovals.contextKind, "chat"),
              eq(toolApprovals.contextId, turn.id),
            ),
          )
          .run();
      }
      tx.delete(chatSessions).where(eq(chatSessions.id, id)).run();
    });
  }

  createTurn(
    sessionId: string,
    id: string = crypto.randomUUID(),
    now = new Date(),
  ): ChatTurnRow {
    return this.db.transaction((tx) => {
      const session = tx
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId))
        .get();
      if (!session) throw new Error(`Unknown chat session: ${sessionId}`);
      if (session.status !== "active") {
        throw new Error(`Chat session is archived: ${sessionId}`);
      }
      if (session.activeTurnId) {
        throw new Error(
          `Chat session already has an active turn: ${sessionId}`,
        );
      }

      tx.insert(chatTurns)
        .values({
          id,
          sessionId,
          status: "queued",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.update(chatSessions)
        .set({ activeTurnId: id, updatedAt: now })
        .where(eq(chatSessions.id, sessionId))
        .run();
      const turn = tx
        .select()
        .from(chatTurns)
        .where(eq(chatTurns.id, id))
        .get();
      if (!turn) throw new Error(`Chat turn was not persisted: ${id}`);
      return turn;
    });
  }

  setTurnStatus(
    id: string,
    statusValue: ChatTurnStatus,
    options: { readonly now?: Date; readonly error?: string } = {},
  ): ChatTurnRow {
    const status = chatTurnStatusSchema.parse(statusValue);
    const now = options.now ?? new Date();
    return this.db.transaction((tx) => {
      const current = tx
        .select()
        .from(chatTurns)
        .where(eq(chatTurns.id, id))
        .get();
      if (!current) throw new Error(`Unknown chat turn: ${id}`);
      if (!isValidChatTurnTransition(current.status, status)) {
        throw new Error(
          `Invalid chat turn transition: ${current.status} -> ${status}`,
        );
      }

      const terminal = isTerminalChatTurnStatus(status);
      tx.update(chatTurns)
        .set({
          status,
          startedAt:
            current.startedAt ?? (status === "streaming" ? now : undefined),
          finishedAt: terminal ? now : null,
          error: status === "failed" ? optionalText(options.error) : null,
          updatedAt: now,
        })
        .where(eq(chatTurns.id, id))
        .run();
      if (terminal) {
        tx.update(chatSessions)
          .set({ activeTurnId: null, updatedAt: now })
          .where(
            and(
              eq(chatSessions.id, current.sessionId),
              eq(chatSessions.activeTurnId, id),
            ),
          )
          .run();
      }
      const turn = tx
        .select()
        .from(chatTurns)
        .where(eq(chatTurns.id, id))
        .get();
      if (!turn) throw new Error(`Chat turn was not persisted: ${id}`);
      return turn;
    });
  }

  appendMessage(input: AppendChatMessageInput): ChatMessageRow {
    const role = chatMessageRoleSchema.parse(input.role);
    const content = parseDurableChatContent({
      parts: input.parts,
      metadata: input.metadata ?? {},
    });
    const createdAt = input.createdAt ?? new Date();
    const id = input.id ?? crypto.randomUUID();

    return this.db.transaction((tx) => {
      const session = tx
        .select({ id: chatSessions.id, status: chatSessions.status })
        .from(chatSessions)
        .where(eq(chatSessions.id, input.sessionId))
        .get();
      if (!session) throw new Error(`Unknown chat session: ${input.sessionId}`);
      if (session.status !== "active") {
        throw new Error(`Chat session is archived: ${input.sessionId}`);
      }
      if (input.turnId) {
        const turn = tx
          .select({ sessionId: chatTurns.sessionId })
          .from(chatTurns)
          .where(eq(chatTurns.id, input.turnId))
          .get();
        if (!turn || turn.sessionId !== input.sessionId) {
          throw new Error(
            `Chat turn does not belong to session: ${input.turnId}`,
          );
        }
      }

      const latest = tx
        .select({ sequence: max(chatMessages.sequence) })
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.sessionId))
        .get();
      const sequence = (latest?.sequence ?? -1) + 1;
      tx.insert(chatMessages)
        .values({
          id,
          sessionId: input.sessionId,
          turnId: input.turnId,
          sequence,
          role,
          schemaVersion: 1,
          parts: content.parts,
          metadata: content.metadata,
          createdAt,
        })
        .run();
      tx.update(chatSessions)
        .set({ lastMessageAt: createdAt, updatedAt: createdAt })
        .where(eq(chatSessions.id, input.sessionId))
        .run();
      const message = tx
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, id))
        .get();
      if (!message) throw new Error(`Chat message was not persisted: ${id}`);
      return message;
    });
  }

  replaceMessage(id: string, input: ReplaceChatMessageInput): ChatMessageRow {
    const current = this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, id))
      .get();
    if (!current) throw new Error(`Unknown chat message: ${id}`);
    const content = parseDurableChatContent({
      parts: input.parts,
      metadata: input.metadata ?? current.metadata,
    });
    const now = input.now ?? new Date();
    this.db.transaction((tx) => {
      tx.update(chatMessages)
        .set({ parts: content.parts, metadata: content.metadata })
        .where(eq(chatMessages.id, id))
        .run();
      tx.update(chatSessions)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(chatSessions.id, current.sessionId))
        .run();
    });
    const message = this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, id))
      .get();
    if (!message) throw new Error(`Chat message was not persisted: ${id}`);
    return message;
  }

  listMessages(sessionId: string): readonly ChatMessageRow[] {
    return this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.sequence))
      .all();
  }

  listTurns(sessionId: string): readonly ChatTurnRow[] {
    return this.db
      .select()
      .from(chatTurns)
      .where(eq(chatTurns.sessionId, sessionId))
      .orderBy(asc(chatTurns.createdAt))
      .all();
  }

  recordWorkflow(input: RecordAssistantWorkflowInput): AssistantWorkflowRow {
    const kind = assistantWorkflowKindSchema.parse(input.kind);
    const sourceToolCallId = input.sourceToolCallId.trim();
    if (!sourceToolCallId) {
      throw new TypeError("Assistant workflow tool call ID is required");
    }
    if (JSON.stringify(input.payload).length > 128_000) {
      throw new RangeError(
        "Assistant workflow payload must be 128 KB or smaller",
      );
    }
    const now = input.now ?? new Date();
    const id = input.id ?? crypto.randomUUID();
    return this.db.transaction((tx) => {
      const session = tx
        .select({ status: chatSessions.status })
        .from(chatSessions)
        .where(eq(chatSessions.id, input.sessionId))
        .get();
      if (!session) throw new Error(`Unknown chat session: ${input.sessionId}`);
      if (session.status !== "active") {
        throw new Error(`Chat session is archived: ${input.sessionId}`);
      }
      const message = tx
        .select({ sessionId: chatMessages.sessionId })
        .from(chatMessages)
        .where(eq(chatMessages.id, input.sourceMessageId))
        .get();
      if (!message || message.sessionId !== input.sessionId) {
        throw new Error(
          `Assistant workflow source message does not belong to session: ${input.sourceMessageId}`,
        );
      }
      tx.insert(assistantWorkflows)
        .values({
          id,
          sessionId: input.sessionId,
          sourceMessageId: input.sourceMessageId,
          sourceToolCallId,
          kind,
          status: "proposed",
          schemaVersion: 1,
          payload: input.payload,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      const workflow = tx
        .select()
        .from(assistantWorkflows)
        .where(
          and(
            eq(assistantWorkflows.sessionId, input.sessionId),
            eq(assistantWorkflows.sourceToolCallId, sourceToolCallId),
          ),
        )
        .get();
      if (!workflow) {
        throw new Error(`Assistant workflow was not persisted: ${id}`);
      }
      return workflow;
    });
  }

  getWorkflow(id: string): AssistantWorkflowRow | undefined {
    return this.db
      .select()
      .from(assistantWorkflows)
      .where(eq(assistantWorkflows.id, id))
      .get();
  }

  listWorkflows(sessionId: string): readonly AssistantWorkflowRow[] {
    return this.db
      .select()
      .from(assistantWorkflows)
      .where(eq(assistantWorkflows.sessionId, sessionId))
      .orderBy(asc(assistantWorkflows.createdAt))
      .all();
  }

  updateWorkflow(
    id: string,
    input: UpdateAssistantWorkflowInput,
  ): AssistantWorkflowRow {
    const status = assistantWorkflowStatusSchema.parse(input.status);
    const now = input.now ?? new Date();
    return this.db.transaction((tx) => {
      const workflow = tx
        .select()
        .from(assistantWorkflows)
        .where(eq(assistantWorkflows.id, id))
        .get();
      if (!workflow) throw new Error(`Unknown assistant workflow: ${id}`);
      const session = tx
        .select({ status: chatSessions.status })
        .from(chatSessions)
        .where(eq(chatSessions.id, workflow.sessionId))
        .get();
      if (session?.status !== "active") {
        throw new Error(`Chat session is archived: ${workflow.sessionId}`);
      }
      if (!isValidAssistantWorkflowTransition(workflow.status, status)) {
        throw new Error(
          `Invalid assistant workflow transition: ${workflow.status} -> ${status}`,
        );
      }
      const subject = input.subject;
      tx.update(assistantWorkflows)
        .set({
          status,
          ...(subject
            ? { subjectKind: subject.kind, subjectId: subject.id }
            : undefined),
          ...(input.outcome === undefined
            ? undefined
            : { outcome: input.outcome }),
          ...(input.error === undefined
            ? undefined
            : { error: optionalText(input.error ?? undefined) ?? null }),
          completedAt: isTerminalAssistantWorkflowStatus(status) ? now : null,
          updatedAt: now,
        })
        .where(eq(assistantWorkflows.id, id))
        .run();
      const updated = tx
        .select()
        .from(assistantWorkflows)
        .where(eq(assistantWorkflows.id, id))
        .get();
      if (!updated)
        throw new Error(`Assistant workflow was not updated: ${id}`);
      return updated;
    });
  }

  recoverInterruptedWorkflows(now = new Date()): number {
    const recovered = this.db
      .update(assistantWorkflows)
      .set({
        status: "waiting_for_user",
        error: "Springroll restarted during this action. Review and try again.",
        updatedAt: now,
      })
      .where(eq(assistantWorkflows.status, "in_progress"))
      .returning({ id: assistantWorkflows.id })
      .all();
    return recovered.length;
  }

  recoverInterruptedTurns(now = new Date()): number {
    return this.db.transaction((tx) => {
      let recovered = 0;
      for (const session of tx.select().from(chatSessions).all()) {
        if (!session.activeTurnId) continue;
        const turn = tx
          .select()
          .from(chatTurns)
          .where(eq(chatTurns.id, session.activeTurnId))
          .get();
        if (turn?.status === "waiting_for_user") continue;
        if (turn && !isTerminalChatTurnStatus(turn.status)) {
          tx.update(chatTurns)
            .set({
              status: "failed",
              error:
                "Springroll restarted before this response finished. Try again to continue.",
              finishedAt: now,
              updatedAt: now,
            })
            .where(eq(chatTurns.id, turn.id))
            .run();
          for (const call of tx
            .select()
            .from(modelCalls)
            .where(
              and(
                eq(modelCalls.contextKind, "chat"),
                eq(modelCalls.contextId, turn.id),
                eq(modelCalls.status, "started"),
              ),
            )
            .all()) {
            tx.update(modelCalls)
              .set({
                status: "failed",
                finishedAt: now,
                durationMs: Math.max(
                  0,
                  now.getTime() - call.startedAt.getTime(),
                ),
                error: "Springroll restarted during this model call",
                updatedAt: now,
              })
              .where(eq(modelCalls.id, call.id))
              .run();
          }
        }
        tx.update(chatSessions)
          .set({ activeTurnId: null, updatedAt: now })
          .where(eq(chatSessions.id, session.id))
          .run();
        recovered += 1;
      }
      return recovered;
    });
  }

  scrubTransientProviderData(): number {
    return this.db.transaction((tx) => {
      let scrubbed = 0;
      for (const row of tx.select().from(chatMessages).all()) {
        const parts = toDurableChatParts(
          row.parts as readonly {
            readonly type: string;
            readonly [key: string]: unknown;
          }[],
        );
        const metadata = toDurableChatMetadata(row.metadata, {});
        if (
          JSON.stringify(parts) === JSON.stringify(row.parts) &&
          JSON.stringify(metadata) === JSON.stringify(row.metadata)
        ) {
          continue;
        }
        tx.update(chatMessages)
          .set({ parts, metadata })
          .where(eq(chatMessages.id, row.id))
          .run();
        scrubbed += 1;
      }
      return scrubbed;
    });
  }

  usage(sessionId: string): ChatUsageSummary {
    const row = this.db
      .select({
        inputTokens: sumOrZero(modelCalls.inputTokens),
        outputTokens: sumOrZero(modelCalls.outputTokens),
        reasoningTokens: sumOrZero(modelCalls.reasoningTokens),
        cachedInputTokens: sumOrZero(modelCalls.cachedInputTokens),
        totalTokens: sumOrZero(modelCalls.totalTokens),
        actualCostUsdMicros: sumOrZero(modelCalls.actualCostUsdMicros),
        estimatedCostUsdMicros: sumOrZero(modelCalls.estimatedCostUsdMicros),
        webSearchRequests: sumOrZero(modelCalls.webSearchRequests),
        providerToolCalls: sumOrZero(modelCalls.providerToolCalls),
      })
      .from(chatTurns)
      .innerJoin(
        modelCalls,
        and(
          eq(modelCalls.contextKind, "chat"),
          eq(modelCalls.contextId, chatTurns.id),
        ),
      )
      .where(eq(chatTurns.sessionId, sessionId))
      .get();
    return row ?? emptyUsage();
  }

  /**
   * Tool timings are measured at execution rather than inferred from event
   * order, so parallel calls stay correct. A second start for the same call
   * id restarts the measurement instead of failing the turn — telemetry must
   * never be the thing that breaks a chat.
   */
  startToolCall(input: {
    readonly turnId: string;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly now?: Date;
  }): void {
    const startedAt = input.now ?? new Date();
    this.db
      .insert(chatToolCalls)
      .values({
        id: crypto.randomUUID(),
        turnId: input.turnId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        status: "running",
        startedAt,
      })
      .onConflictDoUpdate({
        target: [chatToolCalls.turnId, chatToolCalls.toolCallId],
        set: { status: "running", startedAt, finishedAt: null },
      })
      .run();
  }

  finishToolCall(input: {
    readonly turnId: string;
    readonly toolCallId: string;
    readonly failed: boolean;
    readonly now?: Date;
  }): void {
    this.db
      .update(chatToolCalls)
      .set({
        status: input.failed ? "failed" : "succeeded",
        finishedAt: input.now ?? new Date(),
      })
      .where(
        and(
          eq(chatToolCalls.turnId, input.turnId),
          eq(chatToolCalls.toolCallId, input.toolCallId),
        ),
      )
      .run();
  }

  listToolCalls(turnId: string): readonly ChatToolCallRow[] {
    return this.db
      .select()
      .from(chatToolCalls)
      .where(eq(chatToolCalls.turnId, turnId))
      .orderBy(asc(chatToolCalls.startedAt))
      .all();
  }

  usageForTurn(turnId: string): ChatUsageSummary {
    const row = this.db
      .select({
        inputTokens: sumOrZero(modelCalls.inputTokens),
        outputTokens: sumOrZero(modelCalls.outputTokens),
        reasoningTokens: sumOrZero(modelCalls.reasoningTokens),
        cachedInputTokens: sumOrZero(modelCalls.cachedInputTokens),
        totalTokens: sumOrZero(modelCalls.totalTokens),
        actualCostUsdMicros: sumOrZero(modelCalls.actualCostUsdMicros),
        estimatedCostUsdMicros: sumOrZero(modelCalls.estimatedCostUsdMicros),
        webSearchRequests: sumOrZero(modelCalls.webSearchRequests),
        providerToolCalls: sumOrZero(modelCalls.providerToolCalls),
      })
      .from(modelCalls)
      .where(
        and(
          eq(modelCalls.contextKind, "chat"),
          eq(modelCalls.contextId, turnId),
        ),
      )
      .get();
    return row ?? emptyUsage();
  }

  private requireSession(id: string): ChatSessionRow {
    const session = this.getSession(id);
    if (!session) throw new Error(`Unknown chat session: ${id}`);
    return session;
  }
}

function sumOrZero(column: AnyColumn): SQL<number> {
  return sql<number>`coalesce(sum(${column}), 0)`;
}

function emptyUsage(): ChatUsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    actualCostUsdMicros: 0,
    estimatedCostUsdMicros: 0,
    webSearchRequests: 0,
    providerToolCalls: 0,
  };
}

function sessionModelColumns(selection: TaskModelSelection | null | undefined):
  | {
      readonly modelProviderId: string | null;
      readonly modelId: string | null;
    }
  | undefined {
  if (selection === undefined) return undefined;
  return {
    modelProviderId: selection?.providerId ?? null,
    modelId: selection?.modelId ?? null,
  };
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
