import type { ModelMessage } from "@ai-sdk/provider-utils";
import {
  dynamicTool,
  isStepCount,
  jsonSchema,
  type LanguageModel,
  type LanguageModelUsage,
  modelMessageSchema,
  type PrepareStepFunction,
  type ProviderMetadata,
  type Telemetry,
  ToolLoopAgent,
  type ToolSet,
} from "ai";
import type { AgentEventPayloadV1, AgentEventSink } from "./agent-events.ts";
import {
  compactToolResultMessages,
  defaultAgentLoopBounds,
  prepareAgentLoopStep,
} from "./agent-loop-policy.ts";
import type { RunResultSource, RunTaskResult } from "./contracts.ts";
import { publicFailureMessage } from "./failures.ts";
import {
  emergencyWrapUpInstructions,
  runSystemPrompt,
  visualBlocks,
} from "./prompts.ts";
import type { ProviderToolBindings } from "./provider-tools.ts";
import {
  createMarkdownRunResult,
  type RunReportRejectionReason,
  runReportRejectionReason,
  selectResearchReport,
} from "./run-results.ts";
import {
  type AgentRunner,
  type AgentRunRequest,
  agentRunTemporalContext,
} from "./run-task.ts";
import {
  type RunImageArtifact,
  toRunResultImageArtifact,
} from "./storage/sqlite-run-artifact-repository.ts";
import {
  compactToolResultLabel,
  summarizeToolOutput,
} from "./tool-result-summary.ts";
import {
  type JsonObject,
  type JsonValue,
  ToolPolicyError,
  type ToolResult,
} from "./tools.ts";

export interface AiSdkModelPricing {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
}

export interface AiSdkProviderUsage {
  readonly webSearchRequests?: number;
  readonly providerToolCalls?: number;
}

export interface AiSdkAgentRunnerOptions {
  readonly maxActiveRunDurationMs?: number;
  readonly maxCumulativeInputTokens?: number;
  readonly maxToolResultCharactersPerCall?: number;
  readonly maxSteps?: number;
  readonly maxRetries?: number;
  readonly system?: string;
  readonly now?: () => Date;
  readonly pricing?: AiSdkModelPricing;
  readonly providerTools?: ProviderToolBindings;
  readonly billing?: "metered" | "subscription" | "unknown";
  readonly catalogRevision?: string;
  readonly providerUsage?: {
    read(): AiSdkProviderUsage;
  };
  readonly emitModelSelection?: boolean;
  readonly artifactReader?: {
    listForRun(runId: string): readonly RunImageArtifact[];
  };
  readonly maxCostUsdMicros?: number;
}

const defaultMaxActiveRunDurationMs =
  defaultAgentLoopBounds.maxActiveDurationMs;
const defaultMaxCumulativeInputTokens =
  defaultAgentLoopBounds.maxCumulativeInputTokens;
const defaultMaxToolResultCharactersPerCall = 50_000;
const defaultMaxSteps = defaultAgentLoopBounds.maxSteps;

export interface RunToolApprovalRequest {
  readonly id: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: JsonObject;
  readonly riskEffect: "read" | "write" | "destructive";
}

export class AgentRunApprovalRequiredError extends Error {
  override readonly name = "AgentRunApprovalRequiredError";

  constructor(
    readonly messages: readonly ModelMessage[],
    readonly approvals: readonly RunToolApprovalRequest[],
  ) {
    super("Scheduled run is waiting for tool approval");
  }
}

export class AiSdkAgentRunner implements AgentRunner {
  readonly #model: LanguageModel;
  readonly #maxActiveRunDurationMs: number;
  readonly #maxCumulativeInputTokens: number;
  readonly #maxToolResultCharactersPerCall: number;
  readonly #maxSteps: number;
  readonly #maxRetries: number;
  readonly #system: string;
  readonly #now: () => Date;
  readonly #pricing: AiSdkModelPricing | undefined;
  readonly #providerTools: ProviderToolBindings;
  readonly #billing: "metered" | "subscription" | "unknown";
  readonly #catalogRevision: string | undefined;
  readonly #providerUsage: AiSdkAgentRunnerOptions["providerUsage"];
  readonly #emitModelSelection: boolean;
  readonly #artifactReader: AiSdkAgentRunnerOptions["artifactReader"];
  readonly #maxCostUsdMicros: number | undefined;

  constructor(model: LanguageModel, options: AiSdkAgentRunnerOptions = {}) {
    this.#model = model;
    this.#maxActiveRunDurationMs =
      options.maxActiveRunDurationMs ?? defaultMaxActiveRunDurationMs;
    this.#maxCumulativeInputTokens =
      options.maxCumulativeInputTokens ?? defaultMaxCumulativeInputTokens;
    this.#maxToolResultCharactersPerCall =
      options.maxToolResultCharactersPerCall ??
      defaultMaxToolResultCharactersPerCall;
    this.#maxSteps = options.maxSteps ?? defaultMaxSteps;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#system = `${options.system ?? runSystemPrompt}\n\n${visualBlocks}`;
    this.#now = options.now ?? (() => new Date());
    this.#pricing = options.pricing;
    this.#providerTools = options.providerTools ?? {};
    this.#billing = options.billing ?? "metered";
    this.#catalogRevision = options.catalogRevision;
    this.#providerUsage = options.providerUsage;
    this.#emitModelSelection = options.emitModelSelection ?? true;
    this.#artifactReader = options.artifactReader;
    this.#maxCostUsdMicros = options.maxCostUsdMicros;

    if (
      !Number.isInteger(this.#maxActiveRunDurationMs) ||
      this.#maxActiveRunDurationMs < 1
    ) {
      throw new RangeError("maxActiveRunDurationMs must be a positive integer");
    }
    if (
      !Number.isInteger(this.#maxCumulativeInputTokens) ||
      this.#maxCumulativeInputTokens < 1
    ) {
      throw new RangeError(
        "maxCumulativeInputTokens must be a positive integer",
      );
    }
    if (
      !Number.isInteger(this.#maxToolResultCharactersPerCall) ||
      this.#maxToolResultCharactersPerCall < 1
    ) {
      throw new RangeError(
        "maxToolResultCharactersPerCall must be a positive integer",
      );
    }
    if (!Number.isInteger(this.#maxSteps) || this.#maxSteps < 2) {
      throw new RangeError("maxSteps must be an integer of at least 2");
    }
    if (!Number.isInteger(this.#maxRetries) || this.#maxRetries < 0) {
      throw new RangeError("maxRetries must be a non-negative integer");
    }
    if (
      this.#maxCostUsdMicros !== undefined &&
      (!Number.isInteger(this.#maxCostUsdMicros) || this.#maxCostUsdMicros < 1)
    ) {
      throw new RangeError("maxCostUsdMicros must be a positive integer");
    }
  }

  async run(request: AgentRunRequest): Promise<RunTaskResult> {
    const startedAt = request.continuation?.startedAt ?? this.#now();
    const activeInvocationStartedAt = this.#now();
    const temporalContext = agentRunTemporalContext(request, startedAt);
    const identity = modelIdentity(this.#model);
    if (this.#emitModelSelection && !request.continuation) {
      await emit(
        request.eventSink,
        {
          type: "model_selection",
          ...identity,
          billing: this.#billing,
          maxSteps: this.#maxSteps,
          ...(this.#catalogRevision
            ? { catalogRevision: this.#catalogRevision }
            : undefined),
          ...(this.#pricing
            ? {
                inputUsdPerMillionTokens:
                  this.#pricing.inputUsdPerMillionTokens,
                outputUsdPerMillionTokens:
                  this.#pricing.outputUsdPerMillionTokens,
              }
            : undefined),
        },
        startedAt,
      );
    }
    if (!request.continuation) {
      await emit(
        request.eventSink,
        { type: "lifecycle", phase: "started" },
        startedAt,
      );
    }
    const tools: ToolSet = {};
    const toolCalls: RunTaskResult["toolCalls"][number][] = [];
    let cumulativeInputTokens =
      request.continuation?.cumulativeInputTokens ?? 0;
    if (!Number.isInteger(cumulativeInputTokens) || cumulativeInputTokens < 0) {
      throw new ToolPolicyError(
        "continuation.cumulativeInputTokens must be a non-negative integer",
      );
    }
    let cumulativeCostUsdMicros =
      request.continuation?.cumulativeCostUsdMicros ?? 0;
    if (
      !Number.isInteger(cumulativeCostUsdMicros) ||
      cumulativeCostUsdMicros < 0
    ) {
      throw new ToolPolicyError(
        "continuation.cumulativeCostUsdMicros must be a non-negative integer",
      );
    }
    const initialModelTurns = request.continuation?.cumulativeModelTurns ?? 0;
    if (!Number.isInteger(initialModelTurns) || initialModelTurns < 0) {
      throw new ToolPolicyError(
        "continuation.cumulativeModelTurns must be a non-negative integer",
      );
    }
    let currentStep = -1;
    let activeTurn:
      | {
          readonly turnId: string;
          readonly step: number;
          readonly provider: string;
          readonly modelId: string;
        }
      | undefined;
    const attemptsByStep = new Map<number, number>();
    let modelStepOffset = initialModelTurns;

    try {
      for (const executableTool of request.tools) {
        const { descriptor, policy } = executableTool;

        if (tools[descriptor.name]) {
          throw new ToolPolicyError(
            `Duplicate AI tool name: ${descriptor.name}`,
          );
        }
        if (descriptor.providerTool) {
          const capability = descriptor.providerTool.capability;
          const binding = this.#providerTools[capability];
          if (binding) {
            if (policy.approval === "before_call") {
              throw new ToolPolicyError(
                `${policy.sourceId}/${policy.name} cannot use provider-executed approval; use the host tool route`,
              );
            }
            tools[descriptor.name] = binding.tool;
            continue;
          }
          if (descriptor.providerTool.fallback !== "host") {
            await emit(
              request.eventSink,
              {
                type: "policy_decision",
                decision: "denied",
                reason: `${policy.name} requires unavailable provider capability ${capability}`,
                ruleId: "provider-tool-unavailable",
              },
              this.#now(),
            );
            throw new ToolPolicyError(
              `${policy.sourceId}/${policy.name} requires unavailable provider capability ${capability}`,
            );
          }
        }

        tools[descriptor.name] = dynamicTool({
          description: descriptor.description,
          inputSchema: jsonSchema(descriptor.inputSchema),
          needsApproval: policy.approval === "before_call",
          execute: async (input, options) => {
            if (!isJsonObject(input)) {
              throw new TypeError(
                `${descriptor.name} expected a JSON object input`,
              );
            }

            const toolStartedAt = this.#now();
            await emit(
              request.eventSink,
              {
                type: "policy_decision",
                decision: "allowed",
                reason:
                  policy.approval === "before_call"
                    ? `${descriptor.name} was approved for this exact call`
                    : `${descriptor.name} is pinned to this task and does not require per-call approval`,
                toolCallId: options.toolCallId,
                ruleId:
                  policy.approval === "before_call"
                    ? "tool-call-approved"
                    : "pinned-tool-allowed",
              },
              toolStartedAt,
            );
            await emit(
              request.eventSink,
              {
                type: "tool_call",
                toolCallId: options.toolCallId,
                toolName: descriptor.name,
                sourceId: policy.sourceId,
                input,
                effect: policy.risk.effect,
                openWorld: policy.risk.openWorld,
                approval: policy.approval,
              },
              toolStartedAt,
            );

            if (policy.approval === "before_call") {
              await request.approvalExecution?.starting(options.toolCallId);
            }

            try {
              const result = await executableTool.execute(input, {
                taskId: request.task.id,
                runId: request.runId,
                toolCallId: options.toolCallId,
                ...(options.abortSignal
                  ? { signal: options.abortSignal }
                  : undefined),
              });
              const boundedResult = boundedToolResultForModel(
                result,
                this.#maxToolResultCharactersPerCall,
              );
              const finishedAt = this.#now();
              const outputSummary = summarizeToolResult(result);
              toolCalls.push({
                toolName: descriptor.name,
                input,
                status: "succeeded",
                startedAt: toolStartedAt,
                finishedAt,
                outputSummary,
              });
              await emit(
                request.eventSink,
                {
                  type: "tool_result",
                  toolCallId: options.toolCallId,
                  status: "succeeded",
                  outputSummary,
                },
                finishedAt,
              );
              if (result.usage) {
                const { billing = "unknown", ...toolUsage } = result.usage;
                cumulativeCostUsdMicros += toolUsage.costUsdMicros ?? 0;
                await emit(
                  request.eventSink,
                  {
                    type: "usage",
                    modelCallId: `${request.runId}:tool:${options.toolCallId}`,
                    billing,
                    ...toolUsage,
                  },
                  finishedAt,
                );
              }
              if (policy.approval === "before_call") {
                await request.approvalExecution?.finished(
                  options.toolCallId,
                  "succeeded",
                );
              }

              return boundedResult.result;
            } catch (error) {
              const finishedAt = this.#now();
              const message = errorMessage(error);
              toolCalls.push({
                toolName: descriptor.name,
                input,
                status: "failed",
                startedAt: toolStartedAt,
                finishedAt,
                error: message,
              });
              await emit(
                request.eventSink,
                {
                  type: "tool_result",
                  toolCallId: options.toolCallId,
                  status: "failed",
                  error: message,
                },
                finishedAt,
              );
              if (policy.approval === "before_call") {
                await request.approvalExecution?.finished(
                  options.toolCallId,
                  "failed",
                );
              }
              throw error;
            }
          },
        });
      }

      const telemetry: Telemetry = {
        onStepStart: async (event) => {
          currentStep = event.stepNumber + modelStepOffset;
          const attempt = (attemptsByStep.get(currentStep) ?? 0) + 1;
          attemptsByStep.set(currentStep, attempt);

          if (attempt === 1) {
            activeTurn = {
              turnId: `${event.callId}:${currentStep}`,
              step: currentStep,
              provider: event.provider,
              modelId: event.modelId,
            };
            await emit(
              request.eventSink,
              {
                type: "model_turn",
                ...activeTurn,
                phase: "started",
              },
              this.#now(),
            );
            return;
          }

          const turnId =
            activeTurn?.turnId ?? `${event.callId}:${Math.max(currentStep, 0)}`;
          await emit(
            request.eventSink,
            {
              type: "model_retry",
              turnId,
              step: Math.max(currentStep, 0),
              attempt,
              provider: event.provider,
              modelId: event.modelId,
            },
            this.#now(),
          );
        },
        onLanguageModelCallEnd: async (event) => {
          const turn = activeTurn ?? {
            turnId: `${event.callId}:${Math.max(currentStep, 0)}`,
            step: Math.max(currentStep, 0),
            provider: event.provider,
            modelId: event.modelId,
          };
          await emit(
            request.eventSink,
            {
              type: "model_turn",
              ...turn,
              phase: "completed",
              finishReason: event.finishReason,
              durationMs: Math.max(
                0,
                Math.round(event.performance.responseTimeMs),
              ),
            },
            this.#now(),
          );
          activeTurn = undefined;
        },
        onStepEnd: async (step) => {
          cumulativeInputTokens += step.usage.inputTokens ?? 0;
          const stepCost = calculateAiSdkCost(
            step.usage,
            this.#pricing,
            step.providerMetadata,
          );
          cumulativeCostUsdMicros += stepCost.costUsdMicros ?? 0;
          await emit(
            request.eventSink,
            toUsageEvent(step, this.#billing, this.#pricing),
            step.response.timestamp ?? this.#now(),
          );
        },
      };
      const instructions = [
        this.#system,
        "# Context",
        `<schedule>\n${temporalContext.instructions}\n</schedule>`,
        recipeContextInstructions(request),
      ]
        .filter(Boolean)
        .join("\n\n");
      const inputMessages = request.continuation
        ? [
            ...request.continuation.messages,
            {
              role: "tool" as const,
              content: request.continuation.approvals.map((approval) => ({
                type: "tool-approval-response" as const,
                approvalId: approval.id,
                approved: approval.approved,
                ...(approval.reason ? { reason: approval.reason } : undefined),
              })),
            },
          ]
        : undefined;
      const configuredToolNames = request.task.tools.map((tool) => tool.name);
      const prepareResearchStep =
        (requireConfiguredTool: boolean): PrepareStepFunction<ToolSet> =>
        ({ messages, stepNumber }) => {
          const effectiveStepNumber = stepNumber + modelStepOffset;
          const loop = prepareAgentLoopStep({
            messages,
            instructions,
            surface: "run",
            ...(identity.provider
              ? { provider: identity.provider }
              : undefined),
            ...(identity.modelId ? { modelId: identity.modelId } : undefined),
            cumulativeInputTokens,
            maxCumulativeInputTokens: this.#maxCumulativeInputTokens,
            elapsedMs:
              this.#now().getTime() - activeInvocationStartedAt.getTime(),
            maxActiveDurationMs: this.#maxActiveRunDurationMs,
            cumulativeCostUsdMicros,
            ...(this.#maxCostUsdMicros !== undefined
              ? { maxCostUsdMicros: this.#maxCostUsdMicros }
              : undefined),
            stepNumber: effectiveStepNumber,
            // Keep one turn in reserve in case the model's first tool-free
            // wrap-up stops without returning usable text.
            wrapUpFromStep: this.#maxSteps - 2,
          });
          const messageOverride = loop?.messages
            ? { messages: loop.messages }
            : {};
          if (loop?.toolChoice === "none") {
            return loop;
          }
          if (requireConfiguredTool && stepNumber === 0) {
            return {
              ...messageOverride,
              activeTools: configuredToolNames,
              toolChoice: "required",
              instructions: `${instructions}\n\n# Missing source evidence\nThe previous attempt used none of this recipe's configured tools. Call one of the available configured tools now and gather current evidence before answering.`,
            };
          }

          return loop;
        };
      const agent = new ToolLoopAgent({
        id: "springroll-task-runner",
        model: this.#model,
        instructions,
        tools,
        maxRetries: this.#maxRetries,
        stopWhen: isStepCount(Math.max(1, this.#maxSteps - initialModelTurns)),
        prepareStep: prepareResearchStep(false),
        telemetry: {
          isEnabled: true,
          recordInputs: false,
          recordOutputs: false,
          integrations: [telemetry],
        },
      });
      const stream = await agent.stream({
        ...(inputMessages
          ? { messages: inputMessages }
          : { prompt: request.task.prompt }),
        ...(request.signal ? { abortSignal: request.signal } : undefined),
      });
      let streamError: unknown;
      try {
        for await (const part of stream.stream) {
          if (part.type === "error") {
            streamError ??= part.error;
          }
        }
      } catch (error) {
        streamError ??= error;
      }
      if (streamError !== undefined) {
        throw streamError;
      }
      const [
        sources,
        steps,
        usage,
        providerMetadata,
        responseMessages,
        response,
        text,
      ] = await Promise.all([
        stream.sources,
        stream.steps,
        stream.usage,
        stream.providerMetadata,
        stream.responseMessages,
        stream.response,
        stream.text,
      ]);
      const approvalRequests = collectApprovalRequests(
        responseMessages,
        request.tools,
      );
      if (approvalRequests.length > 0) {
        const checkpointMessages = durableModelMessages([
          ...(inputMessages ?? [
            { role: "user" as const, content: request.task.prompt },
          ]),
          ...responseMessages,
        ]);
        for (const approval of approvalRequests) {
          await emit(
            request.eventSink,
            {
              type: "policy_decision",
              decision: "approval_required",
              reason: `${approval.toolName} requires approval before execution`,
              toolCallId: approval.toolCallId,
              ruleId: "tool-approval-required",
            },
            this.#now(),
          );
        }
        throw new AgentRunApprovalRequiredError(
          checkpointMessages,
          approvalRequests,
        );
      }
      let researchSources = sources;
      let researchSteps = steps;
      let researchUsage = usage;
      let researchProviderMetadata = providerMetadata;
      let researchResponseMessages = responseMessages;
      let researchResponse = response;
      let researchText = text;
      const configuredActionWasDenied =
        request.continuation?.approvals.some(
          (approval) => !approval.approved,
        ) ?? false;
      if (
        configuredToolNames.length > 0 &&
        !configuredActionWasDenied &&
        !hasConfiguredToolEvidence(
          configuredToolNames,
          toolCalls,
          researchSources,
        )
      ) {
        if (
          cumulativeInputTokens >= this.#maxCumulativeInputTokens ||
          this.#now().getTime() - activeInvocationStartedAt.getTime() >=
            this.#maxActiveRunDurationMs ||
          (this.#maxCostUsdMicros !== undefined &&
            cumulativeCostUsdMicros >= this.#maxCostUsdMicros) ||
          initialModelTurns + researchSteps.length >= this.#maxSteps - 1
        ) {
          throw new Error(
            "The run reached its safety boundary without gathering evidence from a configured tool.",
          );
        }
        modelStepOffset = initialModelTurns + researchSteps.length;
        const evidenceAgent = new ToolLoopAgent({
          id: "springroll-task-runner-evidence-retry",
          model: this.#model,
          instructions,
          tools,
          maxRetries: this.#maxRetries,
          stopWhen: isStepCount(Math.max(1, this.#maxSteps - modelStepOffset)),
          prepareStep: prepareResearchStep(true),
          telemetry: {
            isEnabled: true,
            recordInputs: false,
            recordOutputs: false,
            integrations: [telemetry],
          },
        });
        const evidenceStream = await evidenceAgent.stream({
          messages: [
            ...(inputMessages ?? [
              { role: "user" as const, content: request.task.prompt },
            ]),
            ...researchResponseMessages,
            {
              role: "user" as const,
              content:
                "This attempt cannot be accepted because it used none of the recipe's configured source tools. Gather the required evidence now, then give the best supported answer.",
            },
          ],
          ...(request.signal ? { abortSignal: request.signal } : undefined),
        });
        let evidenceStreamError: unknown;
        try {
          for await (const part of evidenceStream.stream) {
            if (part.type === "error") {
              evidenceStreamError ??= part.error;
            }
          }
        } catch (error) {
          evidenceStreamError ??= error;
        }
        if (evidenceStreamError !== undefined) {
          throw evidenceStreamError;
        }
        const [
          evidenceSources,
          evidenceSteps,
          evidenceUsage,
          evidenceProviderMetadata,
          evidenceResponseMessages,
          evidenceResponse,
          evidenceText,
        ] = await Promise.all([
          evidenceStream.sources,
          evidenceStream.steps,
          evidenceStream.usage,
          evidenceStream.providerMetadata,
          evidenceStream.responseMessages,
          evidenceStream.response,
          evidenceStream.text,
        ]);
        const evidenceApprovalRequests = collectApprovalRequests(
          evidenceResponseMessages,
          request.tools,
        );
        if (evidenceApprovalRequests.length > 0) {
          const checkpointMessages = durableModelMessages([
            ...(inputMessages ?? [
              { role: "user" as const, content: request.task.prompt },
            ]),
            ...researchResponseMessages,
            ...evidenceResponseMessages,
          ]);
          for (const approval of evidenceApprovalRequests) {
            await emit(
              request.eventSink,
              {
                type: "policy_decision",
                decision: "approval_required",
                reason: `${approval.toolName} requires approval before execution`,
                toolCallId: approval.toolCallId,
                ruleId: "tool-approval-required",
              },
              this.#now(),
            );
          }
          throw new AgentRunApprovalRequiredError(
            checkpointMessages,
            evidenceApprovalRequests,
          );
        }
        researchSources = [...researchSources, ...evidenceSources];
        researchSteps = [...researchSteps, ...evidenceSteps];
        researchUsage = addModelUsage(researchUsage, evidenceUsage);
        researchProviderMetadata = mergeProviderMetadata(
          researchProviderMetadata,
          evidenceProviderMetadata,
        );
        researchResponseMessages = [
          ...researchResponseMessages,
          ...evidenceResponseMessages,
        ];
        researchResponse = evidenceResponse;
        researchText = evidenceText;
        if (
          !hasConfiguredToolEvidence(
            configuredToolNames,
            toolCalls,
            researchSources,
          )
        ) {
          throw new Error(
            "The model did not gather evidence from any configured recipe tool after a required retry.",
          );
        }
      }

      let reportCandidates = [
        ...assistantTexts(researchResponseMessages),
        ...(researchText ? [researchText] : []),
      ];
      let report = selectResearchReport(reportCandidates);
      let reportRejection = lastReportRejection(reportCandidates);
      let usedHostFallbackReport = false;
      const modelTurnsUsed = initialModelTurns + researchSteps.length;
      const synthesisWithinSafetyBounds =
        modelTurnsUsed < this.#maxSteps &&
        cumulativeInputTokens < this.#maxCumulativeInputTokens &&
        this.#now().getTime() - activeInvocationStartedAt.getTime() <
          this.#maxActiveRunDurationMs &&
        (this.#maxCostUsdMicros === undefined ||
          cumulativeCostUsdMicros < this.#maxCostUsdMicros);
      if (!report && synthesisWithinSafetyBounds) {
        modelStepOffset = modelTurnsUsed;
        const synthesisAgent = new ToolLoopAgent({
          id: "springroll-task-runner-final-synthesis",
          model: this.#model,
          instructions: `${instructions}\n\n${emergencyWrapUpInstructions("step-count", "run")}`,
          tools: {},
          maxRetries: this.#maxRetries,
          stopWhen: isStepCount(1),
          prepareStep: prepareResearchStep(false),
          telemetry: {
            isEnabled: true,
            recordInputs: false,
            recordOutputs: false,
            integrations: [telemetry],
          },
        });
        const synthesisStream = await synthesisAgent.stream({
          messages: [
            ...(inputMessages ?? [
              { role: "user" as const, content: request.task.prompt },
            ]),
            ...researchResponseMessages,
          ],
          ...(request.signal ? { abortSignal: request.signal } : undefined),
        });
        let synthesisStreamError: unknown;
        try {
          for await (const part of synthesisStream.stream) {
            if (part.type === "error") {
              synthesisStreamError ??= part.error;
            }
          }
        } catch (error) {
          synthesisStreamError ??= error;
        }
        if (synthesisStreamError === undefined) {
          const [
            synthesisSources,
            synthesisSteps,
            synthesisUsage,
            synthesisProviderMetadata,
            synthesisResponseMessages,
            synthesisResponse,
            synthesisText,
          ] = await Promise.all([
            synthesisStream.sources,
            synthesisStream.steps,
            synthesisStream.usage,
            synthesisStream.providerMetadata,
            synthesisStream.responseMessages,
            synthesisStream.response,
            synthesisStream.text,
          ]);
          researchSources = [...researchSources, ...synthesisSources];
          researchSteps = [...researchSteps, ...synthesisSteps];
          researchUsage = addModelUsage(researchUsage, synthesisUsage);
          researchProviderMetadata = mergeProviderMetadata(
            researchProviderMetadata,
            synthesisProviderMetadata,
          );
          researchResponseMessages = [
            ...researchResponseMessages,
            ...synthesisResponseMessages,
          ];
          researchResponse = synthesisResponse;
          researchText = synthesisText;
          reportCandidates = [
            ...assistantTexts(synthesisResponseMessages),
            ...(synthesisText ? [synthesisText] : []),
          ];
          report = selectResearchReport(reportCandidates);
          reportRejection = lastReportRejection(reportCandidates);
        } else if (activeTurn) {
          await emit(
            request.eventSink,
            {
              type: "model_turn",
              ...activeTurn,
              phase: "failed",
            },
            this.#now(),
          );
          activeTurn = undefined;
        }
      }
      if (!report) {
        report = incompleteRunReport(
          toolCalls,
          toRunResultSources(researchSources),
          reportRejection,
        );
        usedHostFallbackReport = true;
      }
      const result = {
        text: report,
        sources: researchSources,
        steps: researchSteps,
        usage: researchUsage,
        response: researchResponse,
        providerMetadata: researchProviderMetadata,
      };
      const finishedAt = this.#now();
      const providerUsage = {
        ...(this.#providerUsage?.read() ?? {}),
        ...observedProviderToolUsage(result),
      };
      const cost = calculateAiSdkCost(
        result.usage,
        this.#pricing,
        result.providerMetadata,
      );

      await this.#recordResultEvents(
        result,
        request,
        finishedAt,
        providerUsage,
        identity,
      );
      await emit(
        request.eventSink,
        { type: "lifecycle", phase: "completed" },
        finishedAt,
      );

      return {
        result: createMarkdownRunResult({
          body: result.text,
          fallbackSummary: request.task.prompt,
          ...(usedHostFallbackReport
            ? {
                disposition: "needs_attention" as const,
                notices: [
                  {
                    level: "warning" as const,
                    message: `The model's final response was ${reportRejectionLabel(reportRejection)}, so Springroll preserved a partial report from the completed work.`,
                  },
                ],
              }
            : undefined),
          sources: toRunResultSources(result.sources),
          artifacts:
            this.#artifactReader
              ?.listForRun(request.runId)
              .map(toRunResultImageArtifact) ?? [],
        }),
        toolCalls,
        usage: {
          ...identity,
          billing: this.#billing,
          ...(result.usage.inputTokens === undefined
            ? undefined
            : { inputTokens: result.usage.inputTokens }),
          ...(result.usage.outputTokens === undefined
            ? undefined
            : { outputTokens: result.usage.outputTokens }),
          ...(result.usage.outputTokenDetails.reasoningTokens === undefined
            ? undefined
            : {
                reasoningTokens:
                  result.usage.outputTokenDetails.reasoningTokens,
              }),
          ...(result.usage.inputTokenDetails.cacheReadTokens === undefined
            ? undefined
            : {
                cachedInputTokens:
                  result.usage.inputTokenDetails.cacheReadTokens,
              }),
          ...(result.usage.totalTokens === undefined
            ? undefined
            : { totalTokens: result.usage.totalTokens }),
          ...cost,
          ...providerUsage,
        },
        startedAt,
        finishedAt,
      };
    } catch (error) {
      if (error instanceof AgentRunApprovalRequiredError) {
        throw error;
      }
      if (activeTurn) {
        await emit(
          request.eventSink,
          {
            type: "model_turn",
            ...activeTurn,
            phase: "failed",
          },
          this.#now(),
        );
        activeTurn = undefined;
      }
      await emit(
        request.eventSink,
        {
          type: "lifecycle",
          phase: isAbortError(error, request.signal) ? "cancelled" : "failed",
          message: errorMessage(error),
        },
        this.#now(),
      );
      throw error;
    }
  }

  async #recordResultEvents(
    result: {
      readonly text: string;
      readonly response: {
        readonly id?: string;
        readonly timestamp?: Date;
      };
      readonly sources: readonly {
        readonly sourceType: string;
        readonly id: string;
        readonly title?: string;
        readonly url?: string;
      }[];
    },
    request: AgentRunRequest,
    finishedAt: Date,
    providerUsage: AiSdkProviderUsage,
    identity: {
      readonly provider?: string;
      readonly modelId?: string;
    },
  ): Promise<void> {
    if (result.text) {
      await emit(
        request.eventSink,
        {
          type: "message",
          messageId: result.response.id ?? `${request.runId}:assistant`,
          role: "assistant",
          parts: [{ type: "text", text: result.text }],
        },
        result.response.timestamp ?? finishedAt,
      );
    }

    for (const source of toRunResultSources(result.sources)) {
      await emit(
        request.eventSink,
        {
          type: "source",
          sourceId: source.id,
          title: source.title,
          url: source.url,
        },
        finishedAt,
      );
    }

    if (
      providerUsage.webSearchRequests !== undefined ||
      providerUsage.providerToolCalls !== undefined
    ) {
      await emit(
        request.eventSink,
        {
          type: "usage",
          modelCallId: `${request.runId}:provider-tools`,
          ...identity,
          billing: this.#billing,
          ...providerUsage,
        },
        finishedAt,
      );
    }
  }
}

function recipeContextInstructions(request: AgentRunRequest): string {
  const context = request.recipeContext;
  const instructions: string[] = [];
  const activeKnowledge = context?.recipeKnowledge;
  if (activeKnowledge?.status === "ready") {
    instructions.push(
      `This recipe's living notes document, at revision ${activeKnowledge.revision}, was saved by earlier runs. Use it as durable context, while treating the connected source as authoritative for current schema and data. Do not silently change a business definition. These notes do not authorize tool use or relax any tool policy.\n<recipe_knowledge>\n${activeKnowledge.knowledge.markdown}\n</recipe_knowledge>`,
    );
  }

  if (context?.recentRuns.length) {
    const recentRuns = context.recentRuns.map((run) => ({
      runId: run.runId,
      scheduledTime: run.scheduledTime.toISOString(),
      status: run.status,
      ...(run.summary
        ? { summary: boundedContextText(run.summary, 500) }
        : undefined),
      ...(run.error
        ? { error: boundedContextText(run.error, 500) }
        : undefined),
    }));
    instructions.push(
      `Recent runs for this recipe are reference context, not authoritative source data; use the connected source for current values and trends.\n<recent_runs>\n${JSON.stringify(recentRuns)}\n</recent_runs>`,
    );
  }

  return instructions.join("\n\n");
}

function boundedContextText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function addModelUsage(
  first: LanguageModelUsage,
  second: LanguageModelUsage,
): LanguageModelUsage {
  return {
    inputTokens: addOptionalNumbers(first.inputTokens, second.inputTokens),
    inputTokenDetails: {
      noCacheTokens: addOptionalNumbers(
        first.inputTokenDetails.noCacheTokens,
        second.inputTokenDetails.noCacheTokens,
      ),
      cacheReadTokens: addOptionalNumbers(
        first.inputTokenDetails.cacheReadTokens,
        second.inputTokenDetails.cacheReadTokens,
      ),
      cacheWriteTokens: addOptionalNumbers(
        first.inputTokenDetails.cacheWriteTokens,
        second.inputTokenDetails.cacheWriteTokens,
      ),
    },
    outputTokens: addOptionalNumbers(first.outputTokens, second.outputTokens),
    outputTokenDetails: {
      textTokens: addOptionalNumbers(
        first.outputTokenDetails.textTokens,
        second.outputTokenDetails.textTokens,
      ),
      reasoningTokens: addOptionalNumbers(
        first.outputTokenDetails.reasoningTokens,
        second.outputTokenDetails.reasoningTokens,
      ),
    },
    totalTokens: addOptionalNumbers(first.totalTokens, second.totalTokens),
  };
}

function addOptionalNumbers(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  return first === undefined && second === undefined
    ? undefined
    : (first ?? 0) + (second ?? 0);
}

function toUsageEvent(
  step: {
    readonly callId: string;
    readonly stepNumber: number;
    readonly model: { readonly provider: string; readonly modelId: string };
    readonly response: { readonly id?: string; readonly timestamp?: Date };
    readonly usage: {
      readonly inputTokens: number | undefined;
      readonly outputTokens: number | undefined;
      readonly totalTokens: number | undefined;
      readonly inputTokenDetails: {
        readonly cacheReadTokens: number | undefined;
      };
      readonly outputTokenDetails: {
        readonly reasoningTokens: number | undefined;
      };
    };
    readonly providerMetadata: ProviderMetadata | undefined;
  },
  billing: "metered" | "subscription" | "unknown",
  pricing: AiSdkModelPricing | undefined,
): AgentEventPayloadV1 {
  return {
    type: "usage",
    modelCallId: step.response.id ?? `${step.callId}:${step.stepNumber}`,
    provider: step.model.provider,
    modelId: step.model.modelId,
    billing,
    ...(step.usage.inputTokens === undefined
      ? undefined
      : { inputTokens: step.usage.inputTokens }),
    ...(step.usage.outputTokens === undefined
      ? undefined
      : { outputTokens: step.usage.outputTokens }),
    ...(step.usage.outputTokenDetails.reasoningTokens === undefined
      ? undefined
      : {
          reasoningTokens: step.usage.outputTokenDetails.reasoningTokens,
        }),
    ...(step.usage.inputTokenDetails.cacheReadTokens === undefined
      ? undefined
      : {
          cachedInputTokens: step.usage.inputTokenDetails.cacheReadTokens,
        }),
    ...(step.usage.totalTokens === undefined
      ? undefined
      : { totalTokens: step.usage.totalTokens }),
    ...calculateAiSdkCost(step.usage, pricing, step.providerMetadata),
  };
}

function observedProviderToolUsage(result: {
  readonly steps: readonly {
    readonly sources: readonly unknown[];
    readonly usage: { readonly raw?: unknown };
  }[];
}): AiSdkProviderUsage {
  const providerToolCalls = result.steps.filter(
    (step) => step.sources.length > 0,
  ).length;
  let webSearchRequests = 0;
  for (const step of result.steps) {
    const rawUsage = step.usage.raw;
    if (!isJsonObject(rawUsage)) {
      continue;
    }
    const serverToolUse = rawUsage.server_tool_use;
    if (!isJsonObject(serverToolUse)) {
      continue;
    }
    const count = serverToolUse.web_search_requests;
    if (typeof count === "number" && Number.isInteger(count) && count > 0) {
      webSearchRequests += count;
    }
  }

  return {
    ...(providerToolCalls > 0 ? { providerToolCalls } : undefined),
    ...(webSearchRequests > 0 ? { webSearchRequests } : undefined),
  };
}

function assistantTexts(messages: readonly ModelMessage[]): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (typeof message.content === "string") {
      if (message.content.trim()) texts.push(message.content);
      continue;
    }
    const parts: string[] = [];
    for (const part of message.content) {
      if (part.type === "text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
    const text = parts.join("").trim();
    if (text) texts.push(text);
  }
  return texts;
}

function incompleteRunReport(
  toolCalls: RunTaskResult["toolCalls"],
  sources: readonly RunResultSource[],
  rejection: RunReportRejectionReason,
): string {
  const succeeded = toolCalls.filter((call) => call.status === "succeeded");
  const failed = toolCalls.length - succeeded.length;
  const callsByTool = new Map<string, number>();
  for (const call of succeeded) {
    callsByTool.set(call.toolName, (callsByTool.get(call.toolName) ?? 0) + 1);
  }
  const evidence = [...callsByTool.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(
      ([toolName, count]) =>
        `- ${toolName.replaceAll("`", "ˋ")}: ${count} successful ${count === 1 ? "call" : "calls"}`,
    );

  return [
    "## Run incomplete",
    "",
    `Springroll gathered evidence, but the model's final response was ${reportRejectionLabel(rejection)}.`,
    "",
    "### Work preserved",
    "",
    `- ${succeeded.length} successful tool ${succeeded.length === 1 ? "call" : "calls"}`,
    ...(failed > 0
      ? [`- ${failed} failed tool ${failed === 1 ? "call" : "calls"}`]
      : []),
    `- ${sources.length} ${sources.length === 1 ? "source" : "sources"} collected`,
    ...evidence,
    "",
    "### What remains",
    "",
    "A narrative answer could not be synthesized from the collected evidence. Review the work log and rerun the recipe if a complete report is required.",
  ].join("\n");
}

function lastReportRejection(
  candidates: readonly string[],
): RunReportRejectionReason {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index] ?? "";
    if (candidate.trim()) {
      return runReportRejectionReason(candidate) ?? "empty";
    }
  }
  return "empty";
}

function reportRejectionLabel(reason: RunReportRejectionReason): string {
  switch (reason) {
    case "empty":
      return "empty";
    case "placeholder":
      return "only a placeholder";
    case "detached":
      return "only a reference to missing earlier content";
    case "heading-only":
      return "only headings";
  }
}

function hasConfiguredToolEvidence(
  configuredToolNames: readonly string[],
  toolCalls: RunTaskResult["toolCalls"],
  sources: readonly unknown[],
): boolean {
  const configured = new Set(configuredToolNames);
  return (
    toolCalls.some(
      (call) => call.status === "succeeded" && configured.has(call.toolName),
    ) || sources.length > 0
  );
}

function mergeProviderMetadata(
  first: ProviderMetadata | undefined,
  second: ProviderMetadata | undefined,
): ProviderMetadata | undefined {
  if (!first) return second;
  if (!second) return first;

  const merged: ProviderMetadata = { ...first, ...second };
  for (const provider of new Set([
    ...Object.keys(first),
    ...Object.keys(second),
  ])) {
    const firstMetadata = first[provider];
    const secondMetadata = second[provider];
    if (!firstMetadata || !secondMetadata) continue;
    const firstUsage = firstMetadata.usage;
    const secondUsage = secondMetadata.usage;
    if (!isRecord(firstUsage) || !isRecord(secondUsage)) continue;
    const firstCost = firstUsage.cost;
    const secondCost = secondUsage.cost;
    if (typeof firstCost !== "number" || typeof secondCost !== "number") {
      continue;
    }
    merged[provider] = {
      ...firstMetadata,
      ...secondMetadata,
      usage: {
        ...firstUsage,
        ...secondUsage,
        cost: firstCost + secondCost,
      },
    };
  }
  return merged;
}

function collectApprovalRequests(
  messages: readonly ModelMessage[],
  tools: AgentRunRequest["tools"],
): RunToolApprovalRequest[] {
  const calls = new Map<
    string,
    { readonly toolName: string; readonly input: JsonObject }
  >();
  const approvalIds: Array<{
    readonly id: string;
    readonly toolCallId: string;
  }> = [];

  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (
        part.type === "tool-call" &&
        typeof part.toolCallId === "string" &&
        typeof part.toolName === "string" &&
        isJsonObject(part.input)
      ) {
        calls.set(part.toolCallId, {
          toolName: part.toolName,
          input: part.input,
        });
      } else if (
        part.type === "tool-approval-request" &&
        typeof part.approvalId === "string" &&
        typeof part.toolCallId === "string"
      ) {
        approvalIds.push({
          id: part.approvalId,
          toolCallId: part.toolCallId,
        });
      }
    }
  }

  return approvalIds.map(({ id, toolCallId }) => {
    const call = calls.get(toolCallId);
    if (!call) {
      throw new ToolPolicyError(
        `Approval request references an unknown tool call: ${toolCallId}`,
      );
    }
    if (JSON.stringify(call.input).length > 64_000) {
      throw new ToolPolicyError(
        `Approval input exceeds the 64 KB safety limit: ${call.toolName}`,
      );
    }
    const executable = tools.find(
      ({ descriptor }) => descriptor.name === call.toolName,
    );
    if (executable?.policy.approval !== "before_call") {
      throw new ToolPolicyError(
        `Approval request references an unapproved tool: ${call.toolName}`,
      );
    }
    return {
      id,
      toolCallId,
      toolName: call.toolName,
      input: call.input,
      riskEffect: executable.policy.risk.effect,
    };
  });
}

function durableModelMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  const sanitized = messages.map((message) =>
    modelMessageSchema.parse(stripPrivateModelMetadata(message)),
  );
  const compacted = compactToolResultMessages(sanitized) ?? sanitized;
  const encoded = JSON.stringify(compacted);
  if (encoded.length > 5_000_000) {
    throw new ToolPolicyError(
      "Scheduled run continuation exceeds the 5 MB emergency storage limit",
    );
  }
  const value = JSON.parse(encoded) as unknown;
  if (!Array.isArray(value)) {
    throw new ToolPolicyError("Scheduled run continuation is invalid");
  }
  return value.map((message) => modelMessageSchema.parse(message));
}

function stripPrivateModelMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          !isRecord(item) ||
          (item.type !== "reasoning" && item.type !== "reasoning-file"),
      )
      .map(stripPrivateModelMetadata);
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => key !== "providerOptions" && key !== "providerMetadata",
      )
      .map(([key, item]) => [key, stripPrivateModelMetadata(item)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarizeToolResult(result: ToolResult): string {
  const compact = summarizeToolOutput(result);
  if (compact) return compact;
  const firstText = result.content.find(
    (item): item is string => typeof item === "string",
  );
  const summary = firstText ?? JSON.stringify(result.structuredContent ?? {});
  return compactToolResultLabel(summary);
}

function boundedToolResultForModel(
  result: ToolResult,
  maxCharacters: number,
): {
  readonly result: {
    readonly content: readonly JsonValue[];
    readonly structuredContent?: JsonObject;
  };
  readonly characters: number;
} {
  const modelResult = {
    content: result.content,
    ...(result.structuredContent
      ? { structuredContent: result.structuredContent }
      : undefined),
  };
  const encoded = JSON.stringify(modelResult);
  if (encoded.length <= maxCharacters) {
    return {
      result: modelResult,
      characters: encoded.length,
    };
  }

  const notice = `Tool result truncated from ${encoded.length.toLocaleString()} characters to fit Springroll's per-call context limit.`;
  let excerptLength = Math.max(0, maxCharacters - notice.length - 300);
  let bounded = {
    content: [encoded.slice(0, excerptLength), notice],
    structuredContent: {
      truncated: true,
      originalCharacters: encoded.length,
      includedCharacters: excerptLength,
    },
  } satisfies ToolResult;
  let boundedCharacters = JSON.stringify(bounded).length;
  if (boundedCharacters > maxCharacters && excerptLength > 0) {
    excerptLength = Math.max(
      0,
      excerptLength - (boundedCharacters - maxCharacters),
    );
    bounded = {
      content: [encoded.slice(0, excerptLength), notice],
      structuredContent: {
        truncated: true,
        originalCharacters: encoded.length,
        includedCharacters: excerptLength,
      },
    };
    boundedCharacters = JSON.stringify(bounded).length;
  }
  return { result: bounded, characters: boundedCharacters };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : publicFailureMessage(error);
}

async function emit(
  sink: AgentEventSink | undefined,
  payload: AgentEventPayloadV1,
  occurredAt: Date,
): Promise<void> {
  await sink?.append(payload, occurredAt);
}

function isAbortError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function modelIdentity(model: LanguageModel): {
  readonly provider?: string;
  readonly modelId?: string;
} {
  if (typeof model === "string") {
    return { modelId: model };
  }

  return {
    provider: model.provider,
    modelId: model.modelId,
  };
}

export function calculateAiSdkCost(
  usage: {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
  },
  pricing: AiSdkModelPricing | undefined,
  providerMetadata: ProviderMetadata | undefined,
): {
  readonly costUsdMicros?: number;
  readonly actualCostUsdMicros?: number;
  readonly estimatedCostUsdMicros?: number;
  readonly costSource?: "provider_reported" | "catalog_estimate";
} {
  const providerReportedCost = readProviderReportedCost(providerMetadata);
  const estimatedCostUsdMicros = pricing
    ? Math.round(
        (usage.inputTokens ?? 0) * pricing.inputUsdPerMillionTokens +
          (usage.outputTokens ?? 0) * pricing.outputUsdPerMillionTokens,
      )
    : undefined;
  if (providerReportedCost !== undefined) {
    const actualCostUsdMicros = Math.round(providerReportedCost * 1_000_000);
    return {
      costUsdMicros: actualCostUsdMicros,
      actualCostUsdMicros,
      ...(estimatedCostUsdMicros === undefined
        ? undefined
        : { estimatedCostUsdMicros }),
      costSource: "provider_reported",
    };
  }

  if (estimatedCostUsdMicros === undefined) {
    return {};
  }

  return {
    costUsdMicros: estimatedCostUsdMicros,
    estimatedCostUsdMicros,
    costSource: "catalog_estimate",
  };
}

function readProviderReportedCost(
  providerMetadata: ProviderMetadata | undefined,
): number | undefined {
  for (const metadata of Object.values(providerMetadata ?? {})) {
    const usage = metadata.usage;
    if (
      usage !== null &&
      typeof usage === "object" &&
      !Array.isArray(usage) &&
      typeof usage.cost === "number" &&
      Number.isFinite(usage.cost) &&
      usage.cost >= 0
    ) {
      return usage.cost;
    }
  }

  return undefined;
}

function toRunResultSources(
  sources: readonly {
    readonly sourceType: string;
    readonly id: string;
    readonly title?: string;
    readonly url?: string;
  }[],
): RunResultSource[] {
  const result: RunResultSource[] = [];
  const seenUrls = new Set<string>();

  for (const source of sources) {
    if (
      source.sourceType !== "url" ||
      typeof source.url !== "string" ||
      seenUrls.has(source.url)
    ) {
      continue;
    }

    seenUrls.add(source.url);
    result.push({
      id: source.id,
      title: source.title || source.url,
      url: source.url,
    });
  }

  return result;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object") {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}
