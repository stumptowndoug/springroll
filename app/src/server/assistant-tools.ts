import { type ModelMessage, type ToolSet, tool } from "ai";
import {
  type ApplicationToolCall,
  type ApplicationToolRegistry,
  createSpringrollApplicationToolRegistry,
  hasReachedApplicationToolCallLimit,
  type SpringrollApplicationReadApi,
} from "./application-tool-registry.ts";

export type { SpringrollApplicationReadApi } from "./application-tool-registry.ts";

/** AI SDK projection of the shared, transport-neutral application registry. */
export function createSpringrollApplicationTools(
  application: SpringrollApplicationReadApi,
): ToolSet {
  return createAiSdkApplicationTools(
    createSpringrollApplicationToolRegistry(application),
  );
}

export function createAiSdkApplicationTools(
  registry: ApplicationToolRegistry,
): ToolSet {
  return Object.fromEntries(
    registry.definitions.map((definition) => [
      definition.name,
      tool({
        description: definition.descriptor.description,
        inputSchema: definition.inputSchema,
        execute: (input, { toolCallId, abortSignal, messages }) =>
          registry.execute(definition.name, input, {
            callId: toolCallId,
            ...(abortSignal ? { signal: abortSignal } : undefined),
            priorCalls: applicationToolCallsFromModelMessages(messages),
          }),
      }),
    ]),
  );
}

export function hasReachedWebSearchLimit(
  messages: readonly ModelMessage[],
  connectionId: string,
): boolean {
  return hasReachedApplicationToolCallLimit(
    applicationToolCallsFromModelMessages(messages),
    connectionId,
  );
}

export function applicationToolCallsFromModelMessages(
  messages: readonly ModelMessage[],
): readonly ApplicationToolCall[] {
  const calls: ApplicationToolCall[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (part.type !== "tool-call") continue;
      calls.push({ name: part.toolName, input: part.input });
    }
  }
  return calls;
}
