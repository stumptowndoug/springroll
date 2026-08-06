import type {
  ApprovalPolicy,
  JsonObject,
  JsonValue,
  ToolDescriptor,
  ToolResult,
  ToolRisk,
} from "@springroll/kernel";
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
  | "proposeLocalMcpIntegration"
  | "proposeOpenApiIntegration"
  | "discoverOpenApi"
  | "proposeTask"
  | "proposeTaskUpdate"
  | "proposeTaskToolRepair"
  | "describeConnectionTools"
  | "callReadConnectionTool"
>;

export interface ApplicationToolCall {
  readonly name: string;
  readonly input: unknown;
}

export interface ApplicationToolCallContext {
  readonly callId: string;
  readonly signal?: AbortSignal;
  readonly priorCalls?: readonly ApplicationToolCall[];
}

export interface ApplicationToolPolicy {
  readonly approval: ApprovalPolicy;
  readonly workflow: "inspect" | "proposal";
  readonly risk: ToolRisk;
}

export interface ApplicationToolDefinition {
  readonly name: string;
  readonly descriptor: ToolDescriptor;
  readonly inputSchema: z.ZodType;
  readonly policy: ApplicationToolPolicy;
  execute(
    input: unknown,
    context: ApplicationToolCallContext,
  ): Promise<unknown>;
}

export interface ApplicationToolRegistry {
  readonly definitions: readonly ApplicationToolDefinition[];
  get(name: string): ApplicationToolDefinition | undefined;
  execute(
    name: string,
    input: unknown,
    context: ApplicationToolCallContext,
  ): Promise<unknown>;
}

interface ApplicationToolSpec<TInput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly policy: ApplicationToolPolicy;
  execute(
    input: TInput,
    context: ApplicationToolCallContext,
  ): Promise<unknown> | unknown;
}

const LOCAL_READ_POLICY = readPolicy({ openWorld: false, idempotent: true });
const OPEN_WORLD_READ_POLICY = readPolicy({
  openWorld: true,
  idempotent: true,
});
const OPEN_WORLD_PROPOSAL_POLICY: ApplicationToolPolicy = {
  approval: "never",
  workflow: "proposal",
  risk: { effect: "read", openWorld: true, idempotent: true },
};
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/**
 * The transport-neutral registry for Springroll host capabilities. HTTP/UI,
 * the in-app AI SDK agent, scheduled execution, and MCP adapters should all
 * project these definitions instead of reimplementing their handlers.
 */
export function createSpringrollApplicationToolRegistry(
  application: SpringrollApplicationReadApi,
): ApplicationToolRegistry {
  return createRegistry([
    defineApplicationTool({
      name: "springroll_list_connections",
      description:
        "List Springroll connections and their live availability, authentication rail, and compact tool counts. This never returns credential values or full tool schemas; describe only the matching connected source when details are needed.",
      inputSchema: z.object({}),
      policy: LOCAL_READ_POLICY,
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
            toolCount: connection.tools?.length ?? 0,
            toolEffects: {
              read:
                connection.tools?.filter((tool) => tool.effect === "read")
                  .length ?? 0,
              write:
                connection.tools?.filter((tool) => tool.effect === "write")
                  .length ?? 0,
              destructive:
                connection.tools?.filter(
                  (tool) => tool.effect === "destructive",
                ).length ?? 0,
            },
          }),
        ),
      }),
    }),
    defineApplicationTool({
      name: "springroll_list_tasks",
      description:
        "List existing Springroll tasks with schedule, enabled state, connections, model override, and recent run status.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(50),
      }),
      policy: LOCAL_READ_POLICY,
      execute: async ({ limit }) => ({
        tasks: (await application.listTasks()).slice(0, limit),
      }),
    }),
    defineApplicationTool({
      name: "springroll_get_task",
      description: "Get one Springroll task by its exact task ID.",
      inputSchema: z.object({ taskId: z.string().min(1) }),
      policy: LOCAL_READ_POLICY,
      execute: async ({ taskId }) => {
        const task = await application.getTask(taskId);
        return task ? { found: true, task } : { found: false, taskId };
      },
    }),
    defineApplicationTool({
      name: "springroll_list_runs",
      description:
        "List recent Springroll task runs with status and attention state. Use the run detail tool only for the run that matters.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(25),
      }),
      policy: LOCAL_READ_POLICY,
      execute: async ({ limit }) => ({
        runs: (await application.listRuns()).slice(0, limit),
      }),
    }),
    defineApplicationTool({
      name: "springroll_get_run",
      description:
        "Get one Springroll run, including its safe result, usage, cost, model, and bounded readable body.",
      inputSchema: z.object({ runId: z.string().min(1) }),
      policy: LOCAL_READ_POLICY,
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
    defineApplicationTool({
      name: "springroll_get_model_configuration",
      description:
        "Inspect connected model providers, the default model, and a small filtered set of available models. This never returns API keys.",
      inputSchema: z.object({
        providerId: z.enum(["openrouter", "openai", "xai"]).optional(),
        query: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(25).optional().default(10),
      }),
      policy: LOCAL_READ_POLICY,
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
    defineApplicationTool({
      name: "springroll_research_connection",
      description:
        "Research how to connect a service using Springroll's curated connector templates and official MCP Registry verification. This returns a reviewed setup proposal or an honest unavailable/not-found result; it does not save a manifest, start OAuth, collect a key, or claim the connection works.",
      inputSchema: z.object({
        intent: z
          .string()
          .min(1)
          .max(500)
          .describe("The service and capability the user wants to connect."),
      }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({ intent }) =>
        boundedValue(await application.proposeIntegration(intent), 20_000),
    }),
    defineApplicationTool({
      name: "springroll_propose_local_mcp",
      description:
        "Submit a local MCP package proposal only after researching the provider's MCP-specific official documentation and package repository. Springroll independently reads npm metadata, pins the exact version, and requires the repository to match. Include one to three short capability tags such as analytics, email, search, or database. Preserve required non-secret packageArgs such as an mcp subcommand. Set credentialKind to none when the MCP performs its own login or uses ambient credentials; use api-key only when the MCP documentation explicitly requires an environment variable. Never include a credential value or credential-bearing argument.",
      inputSchema: z
        .object({
          name: z.string().trim().min(1).max(100),
          operator: z.string().trim().min(1).max(100),
          description: z.string().trim().min(1).max(500),
          tags: z
            .array(z.string().trim().min(1).max(30))
            .min(1)
            .max(6)
            .optional(),
          packageName: z
            .string()
            .trim()
            .regex(
              /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/,
            ),
          packageArgs: z
            .array(z.string().trim().min(1).max(200))
            .max(12)
            .optional(),
          repositoryUrl: z.url(),
          credentialKind: z.enum(["api-key", "none"]),
          credentialEnv: z
            .string()
            .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
            .optional()
            .describe(
              "For api-key only: the package's documented environment-variable name, never its value.",
            ),
          credentialPlaceholder: z.string().trim().min(1).max(150).optional(),
          keyCreationUrl: z.url().optional(),
          guidance: z.object({
            summary: z.string().trim().min(1).max(500),
            steps: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
            docsUrl: z.url(),
          }),
          sources: z
            .array(
              z.object({
                title: z.string().trim().min(1).max(200),
                url: z.url(),
              }),
            )
            .min(2)
            .max(6),
        })
        .superRefine((input, context) => {
          if (
            input.credentialKind === "api-key" &&
            (!input.credentialEnv || !input.credentialPlaceholder)
          ) {
            context.addIssue({
              code: "custom",
              path: ["credentialEnv"],
              message:
                "API-key packages require credentialEnv and credentialPlaceholder",
            });
          }
          if (
            input.credentialKind === "none" &&
            (input.credentialEnv || input.credentialPlaceholder)
          ) {
            context.addIssue({
              code: "custom",
              path: ["credentialKind"],
              message:
                "Credential-free packages must not declare credential fields",
            });
          }
        }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({
        credentialKind,
        credentialEnv,
        credentialPlaceholder,
        keyCreationUrl,
        ...input
      }) =>
        boundedValue(
          await application.proposeLocalMcpIntegration({
            ...input,
            credential:
              credentialKind === "api-key"
                ? {
                    kind: "api-key",
                    env: credentialEnv as string,
                    placeholder: credentialPlaceholder as string,
                    ...(keyCreationUrl ? { keyCreationUrl } : {}),
                  }
                : { kind: "none" },
          }),
          30_000,
        ),
    }),
    defineApplicationTool({
      name: "springroll_propose_openapi_connection",
      description:
        "Submit an official OpenAPI connector proposal after finding the provider's own OpenAPI 3.x JSON document and setup documentation. Springroll independently fetches the spec, derives the server and authentication scheme, normalizes the live operations, and rejects cross-provider or unsupported auth. A safe GET verification operation is required: its input must satisfy the operation schema returned by discovery and must use an explicit harmless value rather than an empty object when inputs are available. If documentation says misses are free, prefer a clearly synthetic non-matching lookup over a real person, property, account, or other billable resource. Explain request credits or other metering in notes. This proposal verifies metadata only; never claim the credential or API call was tested until the user completes the native credential step. Never include a credential value.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(100),
        operator: z.string().trim().min(1).max(100),
        description: z.string().trim().min(1).max(500),
        tags: z
          .array(z.string().trim().min(1).max(30))
          .min(1)
          .max(6)
          .optional(),
        specUrl: z.url(),
        docsUrl: z.url(),
        keyCreationUrl: z.url().optional(),
        credentialPlaceholder: z.string().trim().min(1).max(150).optional(),
        probe: z
          .object({
            tool: z.string().trim().min(1).max(300),
            input: z.record(z.string(), jsonValueSchema),
            note: z.string().trim().min(1).max(500),
          }),
        notes: z.array(z.string().trim().min(1).max(500)).max(6).optional(),
        sources: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              url: z.url(),
            }),
          )
          .min(2)
          .max(6),
      }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async (input) =>
        boundedValue(
          await application.proposeOpenApiIntegration(input),
          50_000,
        ),
    }),
    defineApplicationTool({
      name: "springroll_discover_openapi",
      description:
        "Discover and inspect an official provider-owned OpenAPI 3.x JSON document from a product, API documentation, or exact spec URL. Use this immediately after remote-MCP research misses or is unavailable. Springroll checks common same-provider spec locations and returns the derived server, authentication rail, and live operation catalog without saving anything or requesting a credential. Then verify official documentation, metering, and a safe GET probe before submitting an OpenAPI connection proposal.",
      inputSchema: z.object({
        providerUrl: z
          .url()
          .describe(
            "Official provider product, API documentation, or OpenAPI JSON URL.",
          ),
      }),
      policy: OPEN_WORLD_READ_POLICY,
      execute: async ({ providerUrl }) =>
        boundedValue(await application.discoverOpenApi(providerUrl), 50_000),
    }),
    defineApplicationTool({
      name: "springroll_propose_task",
      description:
        "Draft a Springroll recipe from the user's goal using real connected capabilities. This validates the schedule and tools but does not save or enable the recipe. The user reviews the returned proposal in a native card.",
      inputSchema: z.object({
        request: z.string().trim().min(3).max(2_000),
        timezone: z.string().trim().min(1).max(100).optional(),
      }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({ request, timezone }) =>
        boundedValue(
          await application.proposeTask(
            request,
            timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
          30_000,
        ),
    }),
    defineApplicationTool({
      name: "springroll_propose_task_update",
      description:
        "Draft a reviewable update to an existing Springroll recipe. Use this—not springroll_propose_task—when the user wants to fix or edit a recipe. It can change the name, instructions, schedule, timezone, or missed-run policy, preserves unspecified values, and does not apply anything until the user accepts the native review card. It cannot change connections or tools.",
      inputSchema: z
        .object({
          taskId: z.string().trim().min(1).max(200),
          name: z.string().trim().min(2).max(80).optional(),
          prompt: z.string().trim().min(3).max(2_000).optional(),
          schedule: z.string().trim().min(5).max(100).optional(),
          timezone: z.string().trim().min(1).max(100).optional(),
          catchUpPolicy: z.enum(["catch_up", "skip_to_next"]).optional(),
        })
        .refine(
          ({ name, prompt, schedule, timezone, catchUpPolicy }) =>
            name !== undefined ||
            prompt !== undefined ||
            schedule !== undefined ||
            timezone !== undefined ||
            catchUpPolicy !== undefined,
          { message: "Include at least one recipe change" },
        ),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({
        taskId,
        name,
        prompt,
        schedule,
        timezone,
        catchUpPolicy,
      }) =>
        boundedValue(
          await application.proposeTaskUpdate(taskId, {
            ...(name === undefined ? undefined : { name }),
            ...(prompt === undefined ? undefined : { prompt }),
            ...(schedule === undefined ? undefined : { schedule }),
            ...(timezone === undefined ? undefined : { timezone }),
            ...(catchUpPolicy === undefined ? undefined : { catchUpPolicy }),
          }),
          30_000,
        ),
    }),
    defineApplicationTool({
      name: "springroll_propose_task_tool_repair",
      description:
        "Inspect an existing Springroll recipe after a pinned-tool schema-change failure and draft a reviewable repair using the live tool contract. This does not change any pin until the user accepts the native review card.",
      inputSchema: z.object({
        taskId: z.string().trim().min(1).max(200),
      }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({ taskId }) =>
        boundedValue(await application.proposeTaskToolRepair(taskId), 30_000),
    }),
    defineApplicationTool({
      name: "springroll_describe_connection_tools",
      description:
        "Describe one connected Springroll ToolSource on demand, including concise descriptions, JSON input schemas, and normalized read/write/destructive risk. Use a query and small limit when possible. Output schemas are intentionally omitted; call a read tool to inspect real output.",
      inputSchema: z.object({
        connectionId: z.string().min(1),
        query: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
      policy: OPEN_WORLD_READ_POLICY,
      execute: ({ connectionId, query, limit }) =>
        application.describeConnectionTools(connectionId, query, limit),
    }),
    defineApplicationTool({
      name: "springroll_call_read_connection_tool",
      description:
        "Call one connected Springroll tool only when its normalized effect is read. The host rejects write or destructive tools until a separate proposal and durable approval flow exists.",
      inputSchema: z.object({
        connectionId: z.string().min(1),
        toolName: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      }),
      policy: OPEN_WORLD_READ_POLICY,
      execute: async (
        { connectionId, toolName, input },
        { callId, signal, priorCalls },
      ) => {
        if (
          toolName === "search_web" &&
          hasReachedApplicationToolCallLimit(priorCalls ?? [], connectionId)
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
              runId: callId,
              ...(signal ? { signal } : undefined),
            },
          ),
        );
      },
    }),
  ]);
}

export function hasReachedApplicationToolCallLimit(
  priorCalls: readonly ApplicationToolCall[],
  connectionId: string,
): boolean {
  let count = 0;
  for (const call of priorCalls) {
    if (
      call.name !== "springroll_call_read_connection_tool" ||
      !isUnknownObject(call.input) ||
      call.input.connectionId !== connectionId ||
      call.input.toolName !== "search_web"
    ) {
      continue;
    }
    count += 1;
    if (count >= 2) return true;
  }
  return false;
}

function defineApplicationTool<TInput>(
  spec: ApplicationToolSpec<TInput>,
): ApplicationToolDefinition {
  const descriptor: ToolDescriptor = {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.inputSchema) as JsonObject,
    declaredRisk: spec.policy.risk,
  };
  return {
    name: spec.name,
    descriptor,
    inputSchema: spec.inputSchema,
    policy: spec.policy,
    async execute(input, context) {
      return spec.execute(await spec.inputSchema.parseAsync(input), context);
    },
  };
}

function createRegistry(
  definitions: readonly ApplicationToolDefinition[],
): ApplicationToolRegistry {
  const definitionsByName = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );
  if (definitionsByName.size !== definitions.length) {
    throw new Error("Springroll application tool names must be unique");
  }
  return {
    definitions,
    get(name) {
      return definitionsByName.get(name);
    },
    async execute(name, input, context) {
      const definition = definitionsByName.get(name);
      if (!definition) {
        throw new Error(`Unknown Springroll application tool: ${name}`);
      }
      return definition.execute(input, context);
    },
  };
}

function readPolicy(options: {
  readonly openWorld: boolean;
  readonly idempotent: boolean;
}): ApplicationToolPolicy {
  return {
    approval: "never",
    workflow: "inspect",
    risk: { effect: "read", ...options },
  };
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
