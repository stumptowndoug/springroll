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
  "propose_local_mcp",
  "propose_openapi_connection",
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
      .map((definition) => {
        const dynamicApprovalByCall = new Map<string, boolean>();
        return [
          definition.name,
          tool({
            description: definition.descriptor.description,
            inputSchema:
              definition.policy.approval === "before_call" ||
              definition.needsApproval
                ? definition.inputSchema
                : jsonSchema(
                    definition.descriptor.inputSchema as Parameters<
                      typeof jsonSchema
                    >[0],
                  ),
            needsApproval: definition.needsApproval
              ? async (input, { toolCallId }) => {
                  const required = await definition.needsApproval?.(input);
                  dynamicApprovalByCall.set(toolCallId, required === true);
                  return required === true;
                }
              : definition.policy.approval === "before_call",
            execute: async (input, { toolCallId, abortSignal, messages }) => {
              try {
                const userText = latestUserTextFromModelMessages(messages);
                const dynamicallyApproved =
                  dynamicApprovalByCall.get(toolCallId) === true;
                dynamicApprovalByCall.delete(toolCallId);
                return await registry.execute(definition.name, input, {
                  callId: toolCallId,
                  approved:
                    definition.policy.approval === "before_call" ||
                    dynamicallyApproved,
                  ...(abortSignal ? { signal: abortSignal } : undefined),
                  priorCalls: applicationToolCallsFromModelMessages(messages),
                  ...(userText ? { userText } : {}),
                });
              } catch (error) {
                if (
                  (error instanceof ZodError || error instanceof TypeError) &&
                  definition.policy.workflow === "proposal"
                ) {
                  const issues =
                    error instanceof ZodError
                      ? error.issues.slice(0, 12).map((issue) => ({
                          path: issue.path.length
                            ? issue.path.map(String).join(".")
                            : "input",
                          message: issue.message,
                        }))
                      : [
                          {
                            path: "proposal",
                            message: error.message.slice(0, 500),
                          },
                        ];
                  return {
                    status: "invalid_input",
                    title: "The proposal needs correction",
                    tool: definition.name,
                    issues,
                    instruction:
                      "Correct only the listed fields and retry once. Do not repeat the same payload. If the next attempt is rejected, stop and explain which host validation remains unresolved.",
                  };
                }
                throw error;
              }
            },
          }),
        ];
      }),
  );
}

export function latestUserTextFromModelMessages(
  messages: readonly ModelMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    const text = message.content
      .flatMap((part) =>
        part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n")
      .trim();
    if (text) return text;
  }
  return undefined;
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
