import {
  convertToModelMessages,
  createAgentUIStreamResponse,
  isStepCount,
  type LanguageModel,
  type LanguageModelUsage,
  streamText,
  ToolLoopAgent,
  type ToolSet,
  type UIMessage,
  validateUIMessages,
} from "ai";
import {
  compactToolResultMessages,
  defaultAgentLoopBounds,
  prepareAgentLoopStep,
} from "./agent-loop-policy.ts";
import {
  type AiSdkModelPricing,
  calculateAiSdkCost,
} from "./ai-sdk-agent-runner.ts";
import type {
  AssistantWorkflowKind,
  AssistantWorkflowStatus,
  ChatSessionContext,
  ChatSessionEntryMode,
  ChatSubjectReference,
  ChatTurnStatus,
} from "./assistant.ts";
import type { TaskModelSelection } from "./contracts.ts";
import {
  toDurableChatMetadata,
  toDurableChatParts,
} from "./durable-chat-persistence.ts";
import { publicFailureMessage } from "./failures.ts";
import {
  assistantSystemPrompt,
  type EmergencyWrapUpBoundary,
  emergencyWrapUpInstructions,
  visualBlocks,
} from "./prompts.ts";
import type { AppDatabase } from "./storage/database.ts";
import type { AssistantWorkflowRow, ChatSessionRow } from "./storage/schema.ts";
import { SqliteChatStore } from "./storage/sqlite-chat-store.ts";
import { SqliteModelCallStore } from "./storage/sqlite-model-call-store.ts";
import { SqliteToolApprovalStore } from "./storage/sqlite-tool-approval-store.ts";
import type { JsonObject } from "./tools.ts";

export interface AssistantMessageMetadata extends JsonObject {
  readonly createdAt?: string;
  readonly turnId?: string;
  readonly provider?: string;
  readonly modelId?: string;
}

export type AssistantUIMessage = UIMessage<AssistantMessageMetadata>;

export interface AssistantRuntime {
  readonly model: LanguageModel;
  readonly provider: string;
  readonly modelId: string;
  readonly billing?: "metered" | "subscription" | "unknown";
  readonly catalogRevision?: string;
  readonly pricing?: AiSdkModelPricing;
  readonly tools?: ToolSet;
  readonly approvalPolicies?: Readonly<
    Record<string, { readonly riskEffect: "read" | "write" | "destructive" }>
  >;
}

export interface AiSdkAssistantOptions {
  readonly loadRuntime: (
    selection?: TaskModelSelection,
  ) => Promise<AssistantRuntime>;
  readonly now?: () => Date;
  readonly system?: string;
  readonly maxRetries?: number;
  readonly maxSteps?: number;
  readonly maxCumulativeInputTokens?: number;
  readonly maxActiveDurationMs?: number;
  readonly maxContextMessages?: number;
  readonly maxContextChars?: number;
  readonly workflowTools?: Readonly<Record<string, AssistantWorkflowKind>>;
}

/** When each tool call in a turn ran, measured at execution. */
export interface AssistantToolCallTiming {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "running" | "succeeded" | "failed";
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export interface AssistantChatDetail {
  readonly session: AssistantChatSession;
  readonly messages: readonly AssistantUIMessage[];
  readonly turns: readonly (ReturnType<SqliteChatStore["listTurns"]>[number] & {
    readonly usage: ReturnType<SqliteChatStore["usageForTurn"]>;
    readonly toolCalls: readonly AssistantToolCallTiming[];
  })[];
  readonly workflows: ReturnType<SqliteChatStore["listWorkflows"]>;
  readonly approvals: ReturnType<SqliteToolApprovalStore["list"]>;
  readonly usage: ReturnType<SqliteChatStore["usage"]>;
}

export type AssistantChatSession = Omit<
  ChatSessionRow,
  "contextKey" | "modelProviderId" | "modelId"
> & {
  readonly latestTurnStatus: ChatTurnStatus | null;
  readonly modelOverride?: TaskModelSelection;
};

export class AiSdkAssistant {
  readonly #chats: SqliteChatStore;
  readonly #modelCalls: SqliteModelCallStore;
  readonly #approvals: SqliteToolApprovalStore;
  readonly #loadRuntime: (
    selection?: TaskModelSelection,
  ) => Promise<AssistantRuntime>;
  readonly #now: () => Date;
  readonly #system: string;
  readonly #maxRetries: number;
  readonly #maxSteps: number;
  readonly #maxCumulativeInputTokens: number;
  readonly #maxActiveDurationMs: number;
  readonly #maxContextMessages: number;
  readonly #maxContextChars: number;
  readonly #workflowTools: Readonly<Record<string, AssistantWorkflowKind>>;
  readonly #activeTurns = new Map<
    string,
    { readonly turnId: string; readonly controller: AbortController }
  >();

  constructor(db: AppDatabase, options: AiSdkAssistantOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#chats = new SqliteChatStore(db);
    this.#workflowTools = options.workflowTools ?? {};
    this.#chats.scrubTransientProviderData();
    this.#chats.recoverInterruptedTurns(this.#now());
    this.#chats.recoverInterruptedWorkflows(this.#now());
    this.#modelCalls = new SqliteModelCallStore(db);
    this.#approvals = new SqliteToolApprovalStore(db);
    this.#approvals.recoverExecuting(this.#now());
    this.#loadRuntime = options.loadRuntime;
    this.#system =
      options.system ?? `${assistantSystemPrompt}\n\n${visualBlocks}`;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#maxSteps = options.maxSteps ?? defaultAgentLoopBounds.maxSteps;
    this.#maxCumulativeInputTokens =
      options.maxCumulativeInputTokens ??
      defaultAgentLoopBounds.maxCumulativeInputTokens;
    this.#maxActiveDurationMs =
      options.maxActiveDurationMs ?? defaultAgentLoopBounds.maxActiveDurationMs;
    this.#maxContextMessages = options.maxContextMessages ?? 40;
    this.#maxContextChars = options.maxContextChars ?? 120_000;
    if (!Number.isInteger(this.#maxRetries) || this.#maxRetries < 0) {
      throw new RangeError(
        "Assistant maxRetries must be a non-negative integer",
      );
    }
    if (!Number.isInteger(this.#maxSteps) || this.#maxSteps < 1) {
      throw new RangeError("Assistant maxSteps must be a positive integer");
    }
    if (
      !Number.isInteger(this.#maxCumulativeInputTokens) ||
      this.#maxCumulativeInputTokens < 1
    ) {
      throw new RangeError(
        "Assistant maxCumulativeInputTokens must be a positive integer",
      );
    }
    if (
      !Number.isInteger(this.#maxActiveDurationMs) ||
      this.#maxActiveDurationMs < 1
    ) {
      throw new RangeError(
        "Assistant maxActiveDurationMs must be a positive integer",
      );
    }
    if (
      !Number.isInteger(this.#maxContextMessages) ||
      this.#maxContextMessages < 1
    ) {
      throw new RangeError(
        "Assistant maxContextMessages must be a positive integer",
      );
    }
    if (!Number.isInteger(this.#maxContextChars) || this.#maxContextChars < 1) {
      throw new RangeError(
        "Assistant maxContextChars must be a positive integer",
      );
    }
    this.#backfillProjectedWorkflows();
    this.#backfillApprovals();
  }

  createSession(title?: string) {
    return this.#publicSession(
      this.#chats.createSession({
        ...(title === undefined ? undefined : { title }),
        now: this.#now(),
      }),
    );
  }

  createOrResumeSession(input: {
    readonly title?: string;
    readonly context: ChatSessionContext;
    readonly mode?: ChatSessionEntryMode;
    readonly modelSelection?: TaskModelSelection | null;
  }) {
    return this.#publicSession(
      this.#chats.createOrResumeSession({
        ...input,
        now: this.#now(),
      }),
    );
  }

  listSessions(includeArchived = false) {
    return this.#chats
      .listSessions(includeArchived)
      .map((session) => this.#publicSession(session));
  }

  getSession(id: string): AssistantChatDetail | undefined {
    const session = this.#chats.getSession(id);
    if (!session) return undefined;
    return {
      session: this.#publicSession(session),
      messages: this.#chats.listMessages(id).map(toUiMessage),
      turns: this.#chats.listTurns(id).map((turn) => ({
        ...turn,
        usage: this.#chats.usageForTurn(turn.id),
        toolCalls: this.#chats.listToolCalls(turn.id).map((call) => ({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          status: call.status,
          startedAt: call.startedAt,
          finishedAt: call.finishedAt,
        })),
      })),
      workflows: this.#chats.listWorkflows(id),
      approvals: this.#chats
        .listTurns(id)
        .flatMap((turn) => this.#approvals.list("chat", turn.id)),
      usage: this.#chats.usage(id),
    };
  }

  getWorkflow(sessionId: string, workflowId: string) {
    const workflow = this.#chats.getWorkflow(workflowId);
    return workflow?.sessionId === sessionId ? workflow : undefined;
  }

  recordWorkflow(
    sessionId: string,
    input: {
      readonly id?: string;
      readonly sourceMessageId: string;
      readonly sourceToolCallId: string;
      readonly kind: AssistantWorkflowKind;
      readonly payload: JsonObject;
    },
  ) {
    if (!this.#chats.getSession(sessionId)) {
      throw new AssistantSessionNotFoundError(sessionId);
    }
    return this.#chats.recordWorkflow({
      ...input,
      sessionId,
      now: this.#now(),
    });
  }

  updateWorkflow(
    sessionId: string,
    workflowId: string,
    input: {
      readonly status: AssistantWorkflowStatus;
      readonly subject?: ChatSubjectReference;
      readonly outcome?: JsonObject;
      readonly error?: string | null;
    },
  ) {
    if (!this.getWorkflow(sessionId, workflowId)) {
      throw new AssistantWorkflowNotFoundError(sessionId, workflowId);
    }
    return this.#chats.updateWorkflow(workflowId, {
      ...input,
      now: this.#now(),
    });
  }

  archiveSession(id: string) {
    this.cancelSession(id);
    return this.#chats.archiveSession(id, this.#now());
  }

  renameSession(id: string, title: string) {
    if (!this.#chats.getSession(id)) {
      throw new AssistantSessionNotFoundError(id);
    }
    return this.#chats.renameSession(id, title, this.#now());
  }

  updateSessionContext(id: string, context: ChatSessionContext) {
    if (!this.#chats.getSession(id)) {
      throw new AssistantSessionNotFoundError(id);
    }
    return this.#publicSession(
      this.#chats.updateSessionContext(id, context, this.#now()),
    );
  }

  updateSessionModel(id: string, selection: TaskModelSelection | null) {
    if (!this.#chats.getSession(id)) {
      throw new AssistantSessionNotFoundError(id);
    }
    return this.#publicSession(
      this.#chats.updateSessionModel(id, selection, this.#now()),
    );
  }

  restoreSession(id: string) {
    if (!this.#chats.getSession(id)) {
      throw new AssistantSessionNotFoundError(id);
    }
    return this.#chats.restoreSession(id, this.#now());
  }

  deleteSession(id: string): void {
    if (!this.#chats.getSession(id)) {
      throw new AssistantSessionNotFoundError(id);
    }
    this.#chats.deleteSession(id);
  }

  cancelSession(id: string): boolean {
    const session = this.#chats.getSession(id);
    if (!session) throw new AssistantSessionNotFoundError(id);
    if (!session.activeTurnId) return false;
    const active = this.#activeTurns.get(id);
    if (active?.turnId === session.activeTurnId) {
      active.controller.abort(new Error("Assistant response stopped by user"));
    }
    this.#chats.setTurnStatus(session.activeTurnId, "cancelled", {
      now: this.#now(),
    });
    return true;
  }

  async respond(sessionId: string, value: unknown): Promise<Response> {
    const session = this.#chats.getSession(sessionId);
    if (!session) throw new AssistantSessionNotFoundError(sessionId);
    const approvals = parseApprovalDecisions(value);
    const firstApprovalId = approvals?.[0]?.id ?? "unknown";
    let turn: ReturnType<SqliteChatStore["listTurns"]>[number];
    if (approvals) {
      if (!session.activeTurnId || this.#activeTurns.has(sessionId)) {
        throw new AssistantTurnConflictError(sessionId);
      }
      const activeTurn = this.#chats
        .listTurns(sessionId)
        .find((candidate) => candidate.id === session.activeTurnId);
      if (activeTurn?.status !== "waiting_for_user") {
        throw new AssistantApprovalNotFoundError(sessionId, firstApprovalId);
      }
      const message = this.#chats
        .listMessages(sessionId)
        .findLast(
          (candidate) =>
            candidate.role === "assistant" &&
            candidate.turnId === activeTurn.id,
        );
      const pendingApprovalIds = message
        ? approvalRequestIds(message.parts)
        : [];
      if (
        !message ||
        pendingApprovalIds.length !== approvals.length ||
        approvals.some((approval) => !pendingApprovalIds.includes(approval.id))
      ) {
        throw new AssistantApprovalNotFoundError(sessionId, firstApprovalId);
      }
      this.#reconcileApprovals(activeTurn.id, message.id, message.parts, {});
      try {
        this.#approvals.decide("chat", activeTurn.id, approvals, this.#now());
      } catch {
        throw new AssistantApprovalNotFoundError(sessionId, firstApprovalId);
      }
      this.#chats.replaceMessage(message.id, {
        parts: respondToApprovals(message.parts, approvals),
        now: this.#now(),
      });
      turn = activeTurn;
    } else {
      const incoming = await validateIncomingUserMessage(value);
      if (session.activeTurnId) {
        throw new AssistantTurnConflictError(sessionId);
      }
      if (!session.title) {
        this.#chats.renameSession(
          sessionId,
          titleFromUserMessage(incoming),
          this.#now(),
        );
      }
      turn = this.#chats.createTurn(sessionId, undefined, this.#now());
      this.#chats.appendMessage({
        id: crypto.randomUUID(),
        sessionId,
        turnId: turn.id,
        role: "user",
        parts: toDurableParts(incoming.parts),
        metadata: {
          createdAt: this.#now().toISOString(),
          turnId: turn.id,
        },
        createdAt: this.#now(),
      });
    }
    return this.#streamTurn(sessionId, session.context, turn);
  }

  async continueConnectionWorkflow(
    sessionId: string,
    workflowId: string,
  ): Promise<Response | undefined> {
    const session = this.#chats.getSession(sessionId);
    if (!session) throw new AssistantSessionNotFoundError(sessionId);
    const workflow = this.getWorkflow(sessionId, workflowId);
    if (!workflow) {
      throw new AssistantWorkflowNotFoundError(sessionId, workflowId);
    }
    if (workflow.kind !== "connection_setup") {
      return undefined;
    }
    if (session.activeTurnId) {
      return undefined;
    }
    const declined =
      workflow.status === "cancelled" &&
      isUnknownObject(workflow.outcome) &&
      workflow.outcome.state === "declined";
    const connected =
      workflow.status === "completed" &&
      workflow.subjectKind === "connection" &&
      Boolean(workflow.subjectId);
    if (!connected && !declined) return undefined;
    const toolCount =
      connected &&
      isUnknownObject(workflow.outcome) &&
      typeof workflow.outcome.toolCount === "number" &&
      Number.isSafeInteger(workflow.outcome.toolCount) &&
      workflow.outcome.toolCount >= 0
        ? workflow.outcome.toolCount
        : undefined;
    const turn = this.#chats.createTurn(sessionId, undefined, this.#now());
    const event: AssistantUIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        {
          type: "text",
          text: declined
            ? [
                "Springroll host event: the user declined connector setup.",
                "The connector was not connected. No credential value is included in this event.",
                "Continue the user's broader goal without claiming this capability is available. Offer a safe alternative or explain the next useful decision without repeating setup guidance.",
              ].join(" ")
            : [
                "Springroll host event: connector setup completed successfully.",
                `Connection ID: ${JSON.stringify(workflow.subjectId)}.`,
                toolCount === undefined
                  ? "Live tool discovery completed."
                  : `${toolCount} live tools were discovered.`,
                "Continue the user's broader goal now. Inspect the connection through Springroll tools before relying on a capability. Do not ask for or mention credential values, and do not repeat setup guidance unless another user decision is required.",
              ].join(" "),
        },
      ],
      metadata: {
        createdAt: this.#now().toISOString(),
        turnId: turn.id,
      },
    };
    return this.#streamTurn(sessionId, session.context, turn, event);
  }

  async #streamTurn(
    sessionId: string,
    context: ChatSessionContext | null,
    turn: ReturnType<SqliteChatStore["listTurns"]>[number],
    event?: AssistantUIMessage,
  ): Promise<Response> {
    const abortController = new AbortController();
    this.#activeTurns.set(sessionId, {
      turnId: turn.id,
      controller: abortController,
    });

    const activeCalls = new Set<string>();
    let streamError: unknown;
    try {
      const session = this.#chats.getSession(sessionId);
      const runtime = await this.#loadRuntime(
        sessionModelOverride(session ?? undefined),
      );
      const history = this.#chats.listMessages(sessionId).map(toUiMessage);
      const tools = runtime.tools ?? {};
      await validateUIMessages<AssistantUIMessage>({
        messages: history,
      });
      const contextHistory = selectAssistantContext(
        history,
        this.#maxContextMessages,
        this.#maxContextChars,
      );
      const billing = runtime.billing ?? "metered";
      const workflowInstruction = safeConnectionWorkflowInstruction(
        this.#chats.listWorkflows(sessionId),
      );
      const instructions = assistantInstructions(
        this.#system,
        context,
        workflowInstruction || undefined,
      );
      let cumulativeInputTokens = 0;
      const startedAt = this.#now();
      const agent = new ToolLoopAgent({
        id: "springroll-interactive-assistant",
        model: runtime.model,
        instructions,
        tools,
        maxRetries: this.#maxRetries,
        stopWhen: isStepCount(this.#maxSteps),
        prepareStep: ({ messages, stepNumber }) =>
          prepareAgentLoopStep({
            messages,
            instructions,
            surface: "chat",
            cumulativeInputTokens,
            maxCumulativeInputTokens: this.#maxCumulativeInputTokens,
            elapsedMs: this.#now().getTime() - startedAt.getTime(),
            maxActiveDurationMs: this.#maxActiveDurationMs,
            stepNumber,
            wrapUpFromStep: this.#maxSteps - 1,
          }),
        onStepStart: (event) => {
          const id = modelCallId(event.callId, event.stepNumber);
          this.#modelCalls.record({
            id,
            contextKind: "chat",
            contextId: turn.id,
            status: "started",
            provider: event.provider,
            modelId: event.modelId,
            billing,
            ...(runtime.catalogRevision
              ? { catalogRevision: runtime.catalogRevision }
              : undefined),
            ...(runtime.pricing
              ? {
                  inputUsdPerMillionTokens:
                    runtime.pricing.inputUsdPerMillionTokens,
                  outputUsdPerMillionTokens:
                    runtime.pricing.outputUsdPerMillionTokens,
                }
              : undefined),
            startedAt: this.#now(),
          });
          activeCalls.add(id);
        },
        onStepEnd: (step) => {
          cumulativeInputTokens += step.usage.inputTokens ?? 0;
          const id = modelCallId(step.callId, step.stepNumber);
          this.#modelCalls.finish(id, {
            status: "succeeded",
            finishedAt: this.#now(),
            finishReason: step.finishReason,
            ...usageFields(step.usage),
            ...calculateAiSdkCost(
              step.usage,
              runtime.pricing,
              step.providerMetadata,
            ),
          });
          activeCalls.delete(id);
        },
        onToolExecutionStart: ({ toolCall }) => {
          this.#recordToolCallStart(turn.id, toolCall);
          const approval = this.#approvals
            .list("chat", turn.id)
            .find(
              (candidate) =>
                candidate.toolCallId === toolCall.toolCallId &&
                candidate.status === "approved",
            );
          if (approval) {
            this.#approvals.markExecuting(approval.id, this.#now());
          }
        },
        onToolExecutionEnd: ({ toolCall, toolOutput }) => {
          this.#recordToolCallEnd(
            turn.id,
            toolCall,
            toolOutput.type === "tool-error",
          );
          const approval = this.#approvals
            .list("chat", turn.id)
            .find(
              (candidate) =>
                candidate.toolCallId === toolCall.toolCallId &&
                candidate.status === "executing",
            );
          if (approval) {
            this.#approvals.complete(approval.id, {
              status: toolOutput.type === "tool-error" ? "failed" : "succeeded",
              outcome: {
                state:
                  toolOutput.type === "tool-error"
                    ? "output-error"
                    : "output-available",
              },
              now: this.#now(),
            });
          }
        },
      });
      this.#chats.setTurnStatus(turn.id, "streaming", { now: this.#now() });

      return await createAgentUIStreamResponse({
        agent,
        uiMessages: event ? [...contextHistory, event] : [...contextHistory],
        abortSignal: abortController.signal,
        generateMessageId: () => crypto.randomUUID(),
        sendReasoning: false,
        sendSources: true,
        messageMetadata: ({ part }) =>
          part.type === "start"
            ? {
                createdAt: this.#now().toISOString(),
                turnId: turn.id,
                provider: runtime.provider,
                modelId: runtime.modelId,
              }
            : undefined,
        onError: (error) => {
          streamError ??= error;
          const cancelled = abortController.signal.aborted;
          finishActiveCalls(
            this.#modelCalls,
            activeCalls,
            this.#now(),
            cancelled
              ? "Assistant model call cancelled"
              : publicFailureMessage(error),
            cancelled ? "cancelled" : "failed",
          );
          return cancelled
            ? "The response was stopped."
            : publicFailureMessage(error);
        },
        onEnd: async ({
          finishReason,
          isAborted,
          isContinuation,
          responseMessage,
          messages,
        }) => {
          if (isAborted) {
            finishActiveCalls(
              this.#modelCalls,
              activeCalls,
              this.#now(),
              "Assistant model call cancelled",
              "cancelled",
            );
          }
          const hasText = hasTerminalAssistantText(responseMessage.parts);
          const waitingForApproval = hasPendingApproval(responseMessage.parts);
          const canSynthesize =
            !isAborted &&
            !hasText &&
            !waitingForApproval &&
            hasToolEvidence(responseMessage.parts);
          let wrapUpText: string | undefined;
          if (canSynthesize) {
            try {
              wrapUpText = await this.#synthesizeFromEvidence({
                runtime,
                instructions,
                messages,
                turnId: turn.id,
                billing,
                boundary: streamError ? "provider-error" : "step-count",
              });
            } catch (error) {
              streamError ??= error;
            }
          }
          const incomplete =
            !isAborted && !hasText && !wrapUpText && !waitingForApproval;
          let persistenceFailed = false;
          try {
            const durableParts = toDurableParts(responseMessage.parts);
            if (wrapUpText) {
              durableParts.push({
                type: "text",
                text: wrapUpText,
                state: "done",
              });
            } else if (incomplete) {
              durableParts.push({
                type: "text",
                text: streamError
                  ? "I couldn't finish that response. Please try again."
                  : "I stopped before producing an answer. Please try again.",
                state: "done",
              });
            }
            const metadata = toDurableMetadata(responseMessage.metadata, {
              createdAt: this.#now().toISOString(),
              turnId: turn.id,
              provider: runtime.provider,
              modelId: runtime.modelId,
            });
            const message = isContinuation
              ? this.#chats.replaceMessage(responseMessage.id, {
                  parts: durableParts,
                  metadata,
                  now: this.#now(),
                })
              : this.#chats.appendMessage({
                  id: responseMessage.id,
                  sessionId,
                  turnId: turn.id,
                  role: "assistant",
                  parts: durableParts,
                  metadata,
                  createdAt: this.#now(),
                });
            this.#recordProjectedWorkflows(sessionId, message.id, durableParts);
            this.#reconcileApprovals(
              turn.id,
              message.id,
              durableParts,
              runtime.approvalPolicies ?? {},
            );
          } catch (error) {
            streamError ??= error;
            persistenceFailed = true;
          }
          const status = isAborted
            ? "cancelled"
            : waitingForApproval && !persistenceFailed
              ? "waiting_for_user"
              : incomplete || persistenceFailed
                ? "failed"
                : "completed";
          this.#chats.setTurnStatus(turn.id, status, {
            now: this.#now(),
            ...(incomplete || persistenceFailed
              ? {
                  error: persistenceFailed
                    ? "Assistant response could not be saved"
                    : streamError
                      ? publicFailureMessage(streamError)
                      : `Assistant stopped without an answer (${finishReason ?? "unknown finish reason"})`,
                }
              : undefined),
          });
          this.#deleteActiveTurn(sessionId, turn.id);
        },
        consumeSseStream: ({ stream }) => consumeReadableStream(stream),
      });
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      finishActiveCalls(
        this.#modelCalls,
        activeCalls,
        this.#now(),
        cancelled
          ? "Assistant model call cancelled"
          : publicFailureMessage(error),
        cancelled ? "cancelled" : "failed",
      );
      this.#chats.setTurnStatus(turn.id, cancelled ? "cancelled" : "failed", {
        now: this.#now(),
        ...(cancelled
          ? undefined
          : {
              error:
                error instanceof AssistantSessionNotFoundError
                  ? error.message
                  : publicFailureMessage(error),
            }),
      });
      this.#deleteActiveTurn(sessionId, turn.id);
      // User messages and workflow outcomes remain durable, making recovery
      // explicit even when the model response itself fails.
      throw error;
    }
  }

  async #synthesizeFromEvidence(input: {
    readonly runtime: AssistantRuntime;
    readonly instructions: string;
    readonly messages: readonly AssistantUIMessage[];
    readonly turnId: string;
    readonly billing: "metered" | "subscription" | "unknown";
    readonly boundary: EmergencyWrapUpBoundary;
  }): Promise<string> {
    const modelMessages = await convertToModelMessages(
      [...input.messages],
      input.runtime.tools ? { tools: input.runtime.tools } : undefined,
    );
    const compacted = compactToolResultMessages(modelMessages) ?? modelMessages;
    const id = `wrap-up:${input.turnId}`;
    this.#modelCalls.record({
      id,
      contextKind: "chat",
      contextId: input.turnId,
      status: "started",
      provider: input.runtime.provider,
      modelId: input.runtime.modelId,
      billing: input.billing,
      ...(input.runtime.catalogRevision
        ? { catalogRevision: input.runtime.catalogRevision }
        : undefined),
      ...(input.runtime.pricing
        ? {
            inputUsdPerMillionTokens:
              input.runtime.pricing.inputUsdPerMillionTokens,
            outputUsdPerMillionTokens:
              input.runtime.pricing.outputUsdPerMillionTokens,
          }
        : undefined),
      startedAt: this.#now(),
    });
    try {
      const stream = streamText({
        model: input.runtime.model,
        system: `${input.instructions}\n\n${emergencyWrapUpInstructions(input.boundary, "chat")}`,
        messages: compacted,
        maxRetries: 0,
      });
      const [text, usage, finishReason, providerMetadata] = await Promise.all([
        stream.text,
        stream.usage,
        stream.finishReason,
        stream.providerMetadata,
      ]);
      const answer = text.trim();
      if (!answer) {
        this.#modelCalls.finish(id, {
          status: "failed",
          finishedAt: this.#now(),
          error: "Wrap-up produced no answer",
        });
        throw new Error("Wrap-up produced no answer");
      }
      this.#modelCalls.finish(id, {
        status: "succeeded",
        finishedAt: this.#now(),
        finishReason,
        ...usageFields(usage),
        ...calculateAiSdkCost(usage, input.runtime.pricing, providerMetadata),
      });
      return answer;
    } catch (error) {
      const current = this.#modelCalls
        .list("chat", input.turnId)
        .find((call) => call.id === id);
      if (current?.status === "started") {
        this.#modelCalls.finish(id, {
          status: "failed",
          finishedAt: this.#now(),
          error: publicFailureMessage(error),
        });
      }
      throw error;
    }
  }

  #deleteActiveTurn(sessionId: string, turnId: string): void {
    if (this.#activeTurns.get(sessionId)?.turnId === turnId) {
      this.#activeTurns.delete(sessionId);
    }
  }

  /**
   * Tool timings are telemetry, so a storage failure must never take down
   * the turn that produced them.
   */
  #recordToolCallStart(
    turnId: string,
    toolCall: { readonly toolCallId: string; readonly toolName: string },
  ): void {
    try {
      this.#chats.startToolCall({
        turnId,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        now: this.#now(),
      });
    } catch {}
  }

  #recordToolCallEnd(
    turnId: string,
    toolCall: { readonly toolCallId: string },
    failed: boolean,
  ): void {
    try {
      this.#chats.finishToolCall({
        turnId,
        toolCallId: toolCall.toolCallId,
        failed,
        now: this.#now(),
      });
    } catch {}
  }

  #recordProjectedWorkflows(
    sessionId: string,
    messageId: string,
    parts: readonly JsonObject[],
  ): void {
    const projected = new Set<string>();
    for (const part of parts) {
      const type = part.type;
      if (typeof type !== "string" || !type.startsWith("tool-")) continue;
      const kind = this.#workflowTools[type.slice("tool-".length)];
      if (!kind || part.state !== "output-available") continue;
      const toolCallId = part.toolCallId;
      const output = part.output;
      if (typeof toolCallId !== "string" || !isUnknownObject(output)) {
        continue;
      }
      if (output.status !== "ready" || !isUnknownObject(output.proposal)) {
        continue;
      }
      const signature = `${kind}:${JSON.stringify(output.proposal)}`;
      if (projected.has(signature)) continue;
      projected.add(signature);
      this.#chats.recordWorkflow({
        sessionId,
        sourceMessageId: messageId,
        sourceToolCallId: toolCallId,
        kind,
        payload: output as JsonObject,
        now: this.#now(),
      });
    }
  }

  #publicSession(session: ChatSessionRow): AssistantChatSession {
    return publicChatSession(
      session,
      this.#chats.listTurns(session.id).at(-1)?.status ?? null,
    );
  }

  #backfillProjectedWorkflows(): void {
    if (Object.keys(this.#workflowTools).length === 0) return;
    for (const session of this.#chats.listSessions()) {
      for (const message of this.#chats.listMessages(session.id)) {
        if (message.role !== "assistant") continue;
        this.#recordProjectedWorkflows(session.id, message.id, message.parts);
      }
    }
  }

  #backfillApprovals(): void {
    for (const session of this.#chats.listSessions(true)) {
      for (const message of this.#chats.listMessages(session.id)) {
        if (message.role !== "assistant" || !message.turnId) continue;
        this.#reconcileApprovals(message.turnId, message.id, message.parts, {});
      }
    }
  }

  #reconcileApprovals(
    turnId: string,
    messageId: string,
    parts: readonly JsonObject[],
    policies: Readonly<
      Record<string, { readonly riskEffect: "read" | "write" | "destructive" }>
    >,
  ): void {
    for (const part of parts) {
      const type = typeof part.type === "string" ? part.type : undefined;
      const toolCallId =
        typeof part.toolCallId === "string" ? part.toolCallId : undefined;
      const approval = isUnknownObject(part.approval)
        ? part.approval
        : undefined;
      if (
        !type?.startsWith("tool-") ||
        !toolCallId ||
        typeof approval?.id !== "string"
      ) {
        continue;
      }
      const toolName = type.slice("tool-".length);
      const input = isUnknownObject(part.input)
        ? (part.input as JsonObject)
        : { value: part.input ?? null };
      const existing = this.#approvals.get(approval.id);
      const row = this.#approvals.recordPending({
        id: approval.id,
        contextKind: "chat",
        contextId: turnId,
        messageId,
        toolCallId,
        toolName,
        input,
        riskEffect:
          existing?.riskEffect ??
          policies[toolName]?.riskEffect ??
          "destructive",
        now: this.#now(),
      });
      const approved =
        typeof approval.approved === "boolean" ? approval.approved : undefined;
      if (approved !== undefined && row.status === "pending") {
        this.#approvals.decide(
          "chat",
          turnId,
          [
            {
              id: approval.id,
              approved,
              ...(typeof approval.reason === "string"
                ? { reason: approval.reason }
                : undefined),
            },
          ],
          this.#now(),
        );
      }
      const current = this.#approvals.get(approval.id);
      if (
        part.state === "output-available" &&
        (current?.status === "approved" || current?.status === "executing")
      ) {
        this.#approvals.complete(approval.id, {
          status: "succeeded",
          outcome: { state: "output-available" },
          now: this.#now(),
        });
      } else if (
        part.state === "output-error" &&
        (current?.status === "approved" || current?.status === "executing")
      ) {
        this.#approvals.complete(approval.id, {
          status: "failed",
          outcome: { state: "output-error" },
          now: this.#now(),
        });
      }
    }
  }
}

function publicChatSession(
  session: ChatSessionRow,
  latestTurnStatus: ChatTurnStatus | null,
): AssistantChatSession {
  const { contextKey: _, modelProviderId, modelId, ...result } = session;
  return {
    ...result,
    latestTurnStatus,
    ...(modelProviderId && modelId
      ? { modelOverride: { providerId: modelProviderId, modelId } }
      : {}),
  };
}

function sessionModelOverride(
  session: ChatSessionRow | undefined,
): TaskModelSelection | undefined {
  if (!session?.modelProviderId || !session.modelId) return undefined;
  return { providerId: session.modelProviderId, modelId: session.modelId };
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assistantInstructions(
  system: string,
  context: ChatSessionContext | null,
  safeWorkflowInstruction?: string,
): string {
  const contextual = context
    ? (() => {
        const references = context.subjects.length
          ? context.subjects
              .map((subject) => `${subject.kind} ${JSON.stringify(subject.id)}`)
              .join(", ")
          : "none";
        return `${system} Referenced Springroll entities: ${references}. Treat those references as identifiers, inspect them with Springroll tools before making claims, and do not ask the user to repeat an ID that is already present.`;
      })()
    : system;
  return safeWorkflowInstruction
    ? `${contextual} ${safeWorkflowInstruction}`
    : contextual;
}

function safeConnectionWorkflowInstruction(
  workflows: readonly AssistantWorkflowRow[],
): string | undefined {
  const workflow = workflows.findLast(
    (candidate) => candidate.kind === "connection_setup",
  );
  if (!workflow || !isUnknownObject(workflow.outcome)) return undefined;
  const outcome = workflow.outcome;
  const state =
    workflow.status === "completed" && outcome.connected === true
      ? "connected"
      : workflow.status === "cancelled" && outcome.state === "declined"
        ? "declined"
        : outcome.phase === "prepared" &&
            isUnknownObject(outcome.ceremony) &&
            (outcome.ceremony.state === "failed" ||
              outcome.ceremony.state === "expired")
          ? outcome.ceremony.state
          : undefined;
  if (!state) return undefined;
  const retryable =
    state === "failed" || state === "expired" || state === "declined";
  const connectorId =
    typeof outcome.connectorId === "string"
      ? outcome.connectorId
      : workflow.subjectKind === "connection" && workflow.subjectId
        ? workflow.subjectId
        : undefined;
  return [
    `Latest host-owned connector workflow state: ${state}.`,
    `Retryable: ${retryable ? "yes" : "no"}.`,
    ...(connectorId ? [`Connection ID: ${JSON.stringify(connectorId)}.`] : []),
    "This summary intentionally excludes credential values and provider error text; use only this state when reasoning about setup.",
  ].join(" ");
}

export class AssistantSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Unknown chat session: ${sessionId}`);
    this.name = "AssistantSessionNotFoundError";
  }
}

export class AssistantTurnConflictError extends Error {
  constructor(readonly sessionId: string) {
    super(`A response is already in progress for chat session: ${sessionId}`);
    this.name = "AssistantTurnConflictError";
  }
}

export class AssistantApprovalNotFoundError extends Error {
  constructor(
    readonly sessionId: string,
    readonly approvalId: string,
  ) {
    super(`Unknown pending assistant approval: ${sessionId}/${approvalId}`);
    this.name = "AssistantApprovalNotFoundError";
  }
}

export class AssistantWorkflowNotFoundError extends Error {
  constructor(
    readonly sessionId: string,
    readonly workflowId: string,
  ) {
    super(`Unknown assistant workflow: ${sessionId}/${workflowId}`);
    this.name = "AssistantWorkflowNotFoundError";
  }
}

export function selectAssistantContext(
  messages: readonly AssistantUIMessage[],
  maxMessages = 40,
  maxChars = 120_000,
): readonly AssistantUIMessage[] {
  const groups: AssistantUIMessage[][] = [];
  for (const message of messages) {
    const key = message.metadata?.turnId ?? `message:${message.id}`;
    const previous = groups.at(-1);
    const previousKey =
      previous?.[0]?.metadata?.turnId ??
      (previous?.[0] ? `message:${previous[0].id}` : undefined);
    if (previous && previousKey === key) previous.push(message);
    else groups.push([message]);
  }

  const selected: AssistantUIMessage[][] = [];
  let selectedMessages = 0;
  let selectedChars = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) continue;
    const groupChars = JSON.stringify(group).length;
    if (
      selected.length > 0 &&
      (selectedMessages + group.length > maxMessages ||
        selectedChars + groupChars > maxChars)
    ) {
      break;
    }
    selected.unshift(group);
    selectedMessages += group.length;
    selectedChars += groupChars;
  }
  return selected.flat();
}

async function validateIncomingUserMessage(
  value: unknown,
): Promise<AssistantUIMessage> {
  const [message] = await validateUIMessages<AssistantUIMessage>({
    messages: [value],
  });
  if (message?.role !== "user") {
    throw new TypeError("A user message is required");
  }
  if (
    message.parts.length === 0 ||
    message.parts.some(
      (part) =>
        part.type !== "text" ||
        typeof part.text !== "string" ||
        part.text.trim().length === 0,
    )
  ) {
    throw new TypeError("User messages currently support non-empty text only");
  }
  return message;
}

interface AssistantApprovalDecision {
  readonly id: string;
  readonly approved: boolean;
  readonly reason?: string;
}

function parseApprovalDecisions(
  value: unknown,
): readonly AssistantApprovalDecision[] | undefined {
  if (!isUnknownObject(value) || !("approvals" in value)) return undefined;
  if (!Array.isArray(value.approvals) || value.approvals.length === 0) {
    throw new TypeError("At least one tool approval decision is required");
  }
  if (value.approvals.length > 32) {
    throw new TypeError("At most 32 tool approval decisions are allowed");
  }
  const decisions = value.approvals.map((approval) => {
    if (
      !isUnknownObject(approval) ||
      typeof approval.id !== "string" ||
      approval.id.trim().length === 0 ||
      approval.id.length > 200 ||
      typeof approval.approved !== "boolean" ||
      (approval.reason !== undefined && typeof approval.reason !== "string")
    ) {
      throw new TypeError("A valid tool approval decision is required");
    }
    const reason = approval.reason?.trim();
    if (reason && reason.length > 2_000) {
      throw new TypeError(
        "Tool approval reason must be 2,000 characters or fewer",
      );
    }
    return {
      id: approval.id,
      approved: approval.approved,
      ...(reason ? { reason } : undefined),
    };
  });
  if (new Set(decisions.map(({ id }) => id)).size !== decisions.length) {
    throw new TypeError("Tool approval decisions must be unique");
  }
  return decisions;
}

function approvalRequestIds(parts: readonly JsonObject[]): string[] {
  return parts.flatMap((part) =>
    typeof part.type === "string" &&
    part.type.startsWith("tool-") &&
    part.state === "approval-requested" &&
    isUnknownObject(part.approval) &&
    typeof part.approval.id === "string"
      ? [part.approval.id]
      : [],
  );
}

function hasPendingApproval(
  parts: readonly AssistantUIMessage["parts"][number][],
): boolean {
  return parts.some(
    (part) =>
      part.type.startsWith("tool-") &&
      "state" in part &&
      part.state === "approval-requested",
  );
}

function hasToolEvidence(
  parts: readonly AssistantUIMessage["parts"][number][],
): boolean {
  return parts.some(
    (part) =>
      part.type.startsWith("tool-") &&
      "state" in part &&
      (part.state === "output-available" || part.state === "output-error"),
  );
}

function hasTerminalAssistantText(
  parts: readonly AssistantUIMessage["parts"][number][],
): boolean {
  let lastToolIndex = -1;
  for (const [index, part] of parts.entries()) {
    if (part.type.startsWith("tool-")) lastToolIndex = index;
  }
  return parts.some(
    (part, index) =>
      index > lastToolIndex &&
      part.type === "text" &&
      part.text.trim().length > 0,
  );
}

function respondToApprovals(
  parts: readonly JsonObject[],
  decisions: readonly AssistantApprovalDecision[],
): JsonObject[] {
  return parts.map((part) => {
    const decision = decisions.find(
      (candidate) =>
        isUnknownObject(part.approval) && part.approval.id === candidate.id,
    );
    if (
      !decision ||
      typeof part.type !== "string" ||
      !part.type.startsWith("tool-") ||
      part.state !== "approval-requested" ||
      !isUnknownObject(part.approval)
    ) {
      return part;
    }
    return {
      ...part,
      state: "approval-responded",
      approval: {
        ...part.approval,
        id: decision.id,
        approved: decision.approved,
        ...(decision.reason ? { reason: decision.reason } : undefined),
      },
    } as JsonObject;
  });
}

function toUiMessage(
  row: ReturnType<SqliteChatStore["listMessages"]>[number],
): AssistantUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: row.parts as AssistantUIMessage["parts"],
    metadata: row.metadata as AssistantMessageMetadata,
  };
}

function titleFromUserMessage(message: AssistantUIMessage): string {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= 80 ? text : `${text.slice(0, 77).trimEnd()}…`;
}

function toDurableParts(parts: AssistantUIMessage["parts"]): JsonObject[] {
  return toDurableChatParts(parts);
}

function toDurableMetadata(
  metadata: AssistantMessageMetadata | undefined,
  fallback: AssistantMessageMetadata,
): JsonObject {
  return toDurableChatMetadata(metadata, fallback);
}

function usageFields(usage: LanguageModelUsage) {
  return {
    ...(usage.inputTokens === undefined
      ? undefined
      : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined
      ? undefined
      : { outputTokens: usage.outputTokens }),
    ...(usage.outputTokenDetails.reasoningTokens === undefined
      ? undefined
      : { reasoningTokens: usage.outputTokenDetails.reasoningTokens }),
    ...(usage.inputTokenDetails.cacheReadTokens === undefined
      ? undefined
      : { cachedInputTokens: usage.inputTokenDetails.cacheReadTokens }),
    ...(usage.totalTokens === undefined
      ? undefined
      : { totalTokens: usage.totalTokens }),
  };
}

function modelCallId(callId: string, stepNumber: number): string {
  return `${callId}:${stepNumber}`;
}

function finishActiveCalls(
  store: SqliteModelCallStore,
  activeCalls: Set<string>,
  finishedAt: Date,
  error: string,
  status: "failed" | "cancelled" = "failed",
): void {
  for (const id of activeCalls) {
    store.finish(id, { status, finishedAt, error });
  }
  activeCalls.clear();
}

async function consumeReadableStream(stream: ReadableStream<string>) {
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {
      // Draining the server copy keeps persistence alive after disconnects.
    }
  } finally {
    reader.releaseLock();
  }
}
