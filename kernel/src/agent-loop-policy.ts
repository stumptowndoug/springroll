import type { ModelMessage } from "ai";
import { modelMessageSchema } from "ai";
import {
  type EmergencyWrapUpBoundary,
  emergencyWrapUpInstructions,
} from "./prompts.ts";
import { compactSupersededConnectorProposalMessages } from "./web-research-context.ts";

export const defaultAgentLoopBounds = {
  maxSteps: 20,
  maxCumulativeInputTokens: 2_000_000,
  maxActiveDurationMs: 600_000,
} as const;

// Rewriting older messages invalidates provider prompt caches from that point
// on, which costs more than the tokens it saves for any model with cached-input
// discounts. Research distillation bounds per-result size up front, so this
// ledger is an emergency fuse for runaway accumulation, not routine hygiene.
const toolContextCompactionThreshold = 480_000;
const protectedRecentToolResultCharacters = 400_000;
const evidenceLedgerEntryCharacters = 2_000;

export interface AgentLoopStepOverride {
  readonly messages?: ModelMessage[];
  readonly activeTools?: readonly [];
  readonly toolChoice?: "none";
  readonly instructions?: string;
}

export function selectEmergencyBoundary(input: {
  readonly cumulativeInputTokens: number;
  readonly maxCumulativeInputTokens: number;
  readonly elapsedMs: number;
  readonly maxActiveDurationMs: number;
  readonly stepNumber?: number;
  readonly wrapUpFromStep?: number;
}): Exclude<EmergencyWrapUpBoundary, "provider-error"> | undefined {
  if (input.cumulativeInputTokens >= input.maxCumulativeInputTokens) {
    return "context";
  }
  if (input.elapsedMs >= input.maxActiveDurationMs) {
    return "execution-time";
  }
  if (
    input.wrapUpFromStep !== undefined &&
    input.stepNumber !== undefined &&
    input.stepNumber >= input.wrapUpFromStep
  ) {
    return "step-count";
  }
  return undefined;
}

export function prepareAgentLoopStep(input: {
  readonly messages: readonly ModelMessage[];
  readonly instructions: string;
  readonly surface: "run" | "chat";
  readonly cumulativeInputTokens: number;
  readonly maxCumulativeInputTokens: number;
  readonly elapsedMs: number;
  readonly maxActiveDurationMs: number;
  readonly stepNumber?: number;
  readonly wrapUpFromStep?: number;
}): AgentLoopStepOverride | undefined {
  const proposalCompacted = compactSupersededConnectorProposalMessages(
    input.messages,
  );
  const compacted =
    compactToolResultMessages(proposalCompacted ?? input.messages) ??
    proposalCompacted;
  const messageOverride = compacted ? { messages: compacted } : {};
  const boundary = selectEmergencyBoundary(input);
  if (boundary) {
    return {
      ...messageOverride,
      activeTools: [],
      toolChoice: "none",
      instructions: `${input.instructions} ${emergencyWrapUpInstructions(boundary, input.surface)}`,
    };
  }
  return compacted ? messageOverride : undefined;
}

export function compactToolResultMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] | undefined {
  const totalToolResultCharacters = completedToolResultCharacters(messages);
  if (totalToolResultCharacters <= toolContextCompactionThreshold) {
    return undefined;
  }

  const compacted = JSON.parse(JSON.stringify(messages)) as unknown;
  if (!Array.isArray(compacted)) return undefined;
  let protectedCharacters = 0;
  for (
    let messageIndex = compacted.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = compacted[messageIndex];
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (
      let partIndex = message.content.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.content[partIndex];
      if (
        !isRecord(part) ||
        part.type !== "tool-result" ||
        typeof part.toolCallId !== "string" ||
        typeof part.toolName !== "string"
      ) {
        continue;
      }
      const partCharacters = JSON.stringify(part).length;
      if (
        protectedCharacters + partCharacters <=
        protectedRecentToolResultCharacters
      ) {
        protectedCharacters += partCharacters;
        continue;
      }

      const encodedOutput = JSON.stringify(part.output);
      const excerpt = encodedOutput.slice(0, evidenceLedgerEntryCharacters);
      message.content[partIndex] = {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: {
          type: "text",
          value: `[Evidence ledger: older ${part.toolName} result compacted from ${encodedOutput.length.toLocaleString()} characters]\n${excerpt}${encodedOutput.length > excerpt.length ? "…" : ""}`,
        },
      };
    }
  }

  return compacted.map((message) => modelMessageSchema.parse(message));
}

function completedToolResultCharacters(
  messages: readonly ModelMessage[],
): number {
  let characters = 0;
  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content as readonly unknown[]) {
      if (
        isRecord(part) &&
        (part.type === "tool-result" || part.type === "tool-error")
      ) {
        characters += JSON.stringify(part).length;
      }
    }
  }
  return characters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
