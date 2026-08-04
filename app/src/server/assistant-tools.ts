import type { JsonObject, ToolResult } from "@springroll/kernel";
import { type ModelMessage, type ToolSet, tool } from "ai";
import { z } from "zod";
import type { LocalApplication } from "./application.ts";

export type SpringrollApplicationReadApi = Pick<
  LocalApplication,
  | "listConnections"
  | "listTasks"
  | "getTask"
  | "listRuns"
  | "getRun"
  | "modelConfiguration"
  | "proposeIntegration"
  | "proposeTask"
  | "describeConnectionTools"
  | "callReadConnectionTool"
>;

/**
 * Read-only adapter over the same application commands used by HTTP and UI
 * actions. Mutation tools live in a separate proposal/approval registry.
 */
export function createSpringrollApplicationTools(
  application: SpringrollApplicationReadApi,
): ToolSet {
  return {
    springroll_list_connections: tool({
      description:
        "List Springroll connections and their live availability, authentication rail, and discovered tool names. This never returns credential values.",
      inputSchema: z.object({}),
      execute: async () => ({
        connections: (await application.listConnections()).map(
          (connection) => ({
            id: connection.id,
            name: connection.name,
            description: connection.description,
            status: connection.status,
            ...(connection.connectionType
              ? { connectionType: connection.connectionType }
              : undefined),
            ...(connection.custom === undefined
              ? undefined
              : { custom: connection.custom }),
            ...(connection.operator
              ? { operator: connection.operator }
              : undefined),
            ...(connection.endpoint
              ? { endpoint: connection.endpoint }
              : undefined),
            ...(connection.credentialKind
              ? { credentialKind: connection.credentialKind }
              : undefined),
            ...(connection.credentialConfigured === undefined
              ? undefined
              : { credentialConfigured: connection.credentialConfigured }),
            ...(connection.oauthReady === undefined
              ? undefined
              : { oauthReady: connection.oauthReady }),
            ...(connection.availableIn
              ? { availableIn: connection.availableIn }
              : undefined),
            tools: connection.tools ?? [],
          }),
        ),
      }),
    }),
    springroll_list_tasks: tool({
      description:
        "List existing Springroll tasks with schedule, enabled state, connections, model override, and recent run status.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(50),
      }),
      execute: async ({ limit }) => ({
        tasks: (await application.listTasks()).slice(0, limit),
      }),
    }),
    springroll_get_task: tool({
      description: "Get one Springroll task by its exact task ID.",
      inputSchema: z.object({ taskId: z.string().min(1) }),
      execute: async ({ taskId }) => {
        const task = await application.getTask(taskId);
        return task ? { found: true, task } : { found: false, taskId };
      },
    }),
    springroll_list_runs: tool({
      description:
        "List recent Springroll task runs with status and attention state. Use the run detail tool only for the run that matters.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(25),
      }),
      execute: async ({ limit }) => ({
        runs: (await application.listRuns()).slice(0, limit),
      }),
    }),
    springroll_get_run: tool({
      description:
        "Get one Springroll run, including its safe result, usage, cost, model, and bounded readable body.",
      inputSchema: z.object({ runId: z.string().min(1) }),
      execute: async ({ runId }) => {
        const run = await application.getRun(runId);
        if (!run) return { found: false, runId };
        return {
          found: true,
          run: {
            ...run,
            ...(run.body ? { body: boundedText(run.body, 20_000) } : undefined),
            ...(run.result
              ? {
                  result: {
                    ...run.result,
                    body: {
                      ...run.result.body,
                      content: boundedText(run.result.body.content, 20_000),
                    },
                  },
                }
              : undefined),
          },
        };
      },
    }),
    springroll_get_model_configuration: tool({
      description:
        "Inspect connected model providers, the default model, and a small filtered set of available models. This never returns API keys.",
      inputSchema: z.object({
        providerId: z.enum(["openrouter", "openai", "xai"]).optional(),
        query: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(25).optional().default(10),
      }),
      execute: async ({ providerId, query, limit }) => {
        const configuration = await application.modelConfiguration();
        const normalizedQuery = query?.trim().toLocaleLowerCase();
        return {
          providers: configuration.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            kind: provider.kind,
            status: provider.status,
          })),
          ...(configuration.defaultSelection
            ? { defaultSelection: configuration.defaultSelection }
            : undefined),
          catalogUpdatedAt: configuration.catalogUpdatedAt,
          catalogStale: configuration.catalogStale,
          models: configuration.models
            .filter(
              (model) =>
                (!providerId || model.providerId === providerId) &&
                (!normalizedQuery ||
                  model.name.toLocaleLowerCase().includes(normalizedQuery) ||
                  model.modelId.toLocaleLowerCase().includes(normalizedQuery)),
            )
            .slice(0, limit)
            .map((model) => ({
              providerId: model.providerId,
              modelId: model.modelId,
              name: model.name,
              reasoning: model.reasoning,
              toolCall: model.toolCall,
              inputModalities: model.inputModalities,
            })),
        };
      },
    }),
    springroll_research_connection: tool({
      description:
        "Research how to connect a service using Springroll's curated connector templates and official MCP Registry verification. This returns a reviewed setup proposal or an honest unavailable/not-found result; it does not save a manifest, start OAuth, collect a key, or claim the connection works.",
      inputSchema: z.object({
        intent: z
          .string()
          .min(1)
          .max(500)
          .describe("The service and capability the user wants to connect."),
      }),
      execute: async ({ intent }) =>
        boundedValue(await application.proposeIntegration(intent), 20_000),
    }),
    springroll_propose_task: tool({
      description:
        "Draft a Springroll recipe from the user's goal using real connected capabilities. This validates the schedule and tools but does not save or enable the recipe. The user reviews the returned proposal in a native card.",
      inputSchema: z.object({
        request: z.string().trim().min(3).max(2_000),
        timezone: z.string().trim().min(1).max(100).optional(),
      }),
      execute: async ({ request, timezone }) =>
        boundedValue(
          await application.proposeTask(
            request,
            timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
          30_000,
        ),
    }),
    springroll_describe_connection_tools: tool({
      description:
        "Describe a connected Springroll ToolSource on demand, including JSON input schemas and normalized read/write/destructive risk. Use this before calling a connector tool.",
      inputSchema: z.object({
        connectionId: z.string().min(1),
        query: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
      execute: ({ connectionId, query, limit }) =>
        application.describeConnectionTools(connectionId, query, limit),
    }),
    springroll_call_read_connection_tool: tool({
      description:
        "Call one connected Springroll tool only when its normalized effect is read. The host rejects write or destructive tools until a separate proposal and durable approval flow exists.",
      inputSchema: z.object({
        connectionId: z.string().min(1),
        toolName: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      }),
      execute: async (
        { connectionId, toolName, input },
        { toolCallId, abortSignal, messages },
      ) => {
        if (
          toolName === "search_web" &&
          hasReachedWebSearchLimit(messages, connectionId)
        ) {
          return {
            blocked: true,
            reason:
              "Springroll stopped a repetitive web-discovery loop after two searches.",
            nextAction:
              "Call fetch_public_url on the best authoritative result already found, or answer with explicit uncertainty.",
          };
        }
        return boundedToolResult(
          await application.callReadConnectionTool(
            connectionId,
            toolName,
            input as JsonObject,
            {
              runId: toolCallId,
              ...(abortSignal ? { signal: abortSignal } : undefined),
            },
          ),
        );
      },
    }),
  };
}

export function hasReachedWebSearchLimit(
  messages: readonly ModelMessage[],
  connectionId: string,
): boolean {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (
        part.type !== "tool-call" ||
        part.toolName !== "springroll_call_read_connection_tool" ||
        !isUnknownObject(part.input) ||
        part.input.connectionId !== connectionId ||
        part.input.toolName !== "search_web"
      ) {
        continue;
      }
      count += 1;
      if (count >= 2) return true;
    }
  }
  return false;
}

function boundedText(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n\n[Truncated by Springroll]`;
}

function boundedToolResult(result: ToolResult): unknown {
  const projected = {
    content: result.content,
    ...(result.structuredContent
      ? { structuredContent: result.structuredContent }
      : undefined),
  };
  const encoded = JSON.stringify(projected);
  return encoded.length <= 12_000
    ? projected
    : {
        truncated: true,
        preview: encoded.slice(0, 12_000),
        note: "Connector result was truncated by Springroll",
      };
}

function boundedValue(value: unknown, limit: number): unknown {
  const encoded = JSON.stringify(value);
  return encoded.length <= limit
    ? value
    : {
        truncated: true,
        preview: encoded.slice(0, limit),
        note: "Application result was truncated by Springroll",
      };
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
