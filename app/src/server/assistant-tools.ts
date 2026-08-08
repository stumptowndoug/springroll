import { jsonSchema, type ModelMessage, type ToolSet, tool } from "ai";
import { ZodError } from "zod";
import {
  type ApplicationToolCall,
  type ApplicationToolRegistry,
  createSpringrollApplicationToolRegistry,
  type SpringrollApplicationReadApi,
} from "./application-tool-registry.ts";

export type { SpringrollApplicationReadApi } from "./application-tool-registry.ts";

export const legacyAssistantConnectorProposalTools = new Set([
  "springroll_propose_local_mcp",
  "springroll_propose_openapi_connection",
]);

/** AI SDK projection of the shared, transport-neutral application registry. */
export function createSpringrollApplicationTools(
  application: SpringrollApplicationReadApi,
): ToolSet {
  return createAiSdkApplicationTools(
    createSpringrollApplicationToolRegistry(application),
    { exclude: legacyAssistantConnectorProposalTools },
  );
}

export function createAiSdkApplicationTools(
  registry: ApplicationToolRegistry,
  options: { readonly exclude?: ReadonlySet<string> } = {},
): ToolSet {
  return Object.fromEntries(
    registry.definitions
      .filter((definition) => !options.exclude?.has(definition.name))
      .map((definition) => [
        definition.name,
        tool({
          description: definition.descriptor.description,
          inputSchema:
            definition.policy.approval === "before_call"
              ? definition.inputSchema
              : jsonSchema(
                  definition.descriptor.inputSchema as Parameters<
                    typeof jsonSchema
                  >[0],
                ),
          needsApproval: definition.policy.approval === "before_call",
          execute: async (input, { toolCallId, abortSignal, messages }) => {
            try {
              return await registry.execute(definition.name, input, {
                callId: toolCallId,
                approved: definition.policy.approval === "before_call",
                ...(abortSignal ? { signal: abortSignal } : undefined),
                priorCalls: applicationToolCallsFromModelMessages(messages),
              });
            } catch (error) {
              if (
                error instanceof ZodError &&
                definition.policy.workflow === "proposal"
              ) {
                return {
                  status: "invalid_input",
                  title: "The proposal needs correction",
                  tool: definition.name,
                  issues: error.issues.slice(0, 12).map((issue) => ({
                    path: issue.path.length
                      ? issue.path.map(String).join(".")
                      : "input",
                    message: issue.message,
                  })),
                  instruction:
                    "Correct only the listed fields and retry once. Do not repeat the same payload. If the next attempt is rejected, stop and explain which host validation remains unresolved.",
                };
              }
              throw error;
            }
          },
        }),
      ]),
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
