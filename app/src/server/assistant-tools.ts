import { type ToolSet, tool } from "ai";
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
  };
}

function boundedText(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n\n[Truncated by Springroll]`;
}
