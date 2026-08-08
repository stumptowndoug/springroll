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
  | "listApprovalSummaries"
  | "usageSummary"
  | "applicationState"
  | "modelConfiguration"
  | "proposeIntegration"
  | "inspectConnectorSource"
  | "proposeRemoteMcpIntegration"
  | "proposeLocalMcpIntegration"
  | "proposeOpenApiIntegration"
  | "discoverOpenApi"
  | "proposeConnectionAction"
  | "proposeTaskDraft"
  | "proposeTaskUpdate"
  | "proposeTaskToolRepair"
  | "proposeTaskAction"
  | "searchConnectionTools"
  | "describeConnectionTools"
  | "activateConnectionTools"
  | "callReadConnectionTool"
  | "callConnectionTool"
>;

export interface ApplicationToolCall {
  readonly name: string;
  readonly input: unknown;
}

export interface ApplicationToolCallContext {
  readonly callId: string;
  readonly signal?: AbortSignal;
  readonly priorCalls?: readonly ApplicationToolCall[];
  readonly approved?: boolean;
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
const OPEN_WORLD_MUTATION_POLICY: ApplicationToolPolicy = {
  approval: "before_call",
  workflow: "inspect",
  risk: {
    effect: "destructive",
    openWorld: true,
    idempotent: false,
  },
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
const githubLogoUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    [
      "avatars.githubusercontent.com",
      "opengraph.githubassets.com",
      "raw.githubusercontent.com",
    ].includes(url.hostname.toLowerCase())
  );
}, "Logo must use a verified GitHub image host over HTTPS");
const localMcpReviewMetadataSchema = z.object({
  guidanceSummary: z.string().trim().min(1).max(500),
  guidanceSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  docsUrl: z.url(),
  sourceUrls: z
    .array(z.url())
    .min(2)
    .max(6)
    .refine((urls) => new Set(urls).size === urls.length, {
      message: "Official source URLs must be unique",
    }),
});

/**
 * The transport-neutral registry for Springroll host capabilities. HTTP/UI,
 * the in-app AI SDK agent, scheduled execution, and MCP adapters should all
 * project these definitions instead of reimplementing their handlers.
 */
export function createSpringrollApplicationToolRegistry(
  application: SpringrollApplicationReadApi,
): ApplicationToolRegistry {
  const applicationDefinitions = [
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
            ...(connection.connectionIssue === undefined
              ? undefined
              : { connectionIssue: connection.connectionIssue }),
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
      description:
        "Get one Springroll recipe by its exact task ID. Use this to explain its instructions, schedule, enabled state, connections, model override, and recent run statuses before making claims about it.",
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
        "List recent Springroll recipe runs with status, attention state, summaries, and safe error text. Pass taskId when diagnosing a recipe, then use the run detail tool for the failed or otherwise relevant run.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(25),
        taskId: z.string().trim().min(1).max(200).optional(),
      }),
      policy: LOCAL_READ_POLICY,
      execute: async ({ limit, taskId }) => ({
        runs: (await application.listRuns())
          .filter((run) => taskId === undefined || run.taskId === taskId)
          .slice(0, limit),
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
      name: "springroll_list_approvals",
      description:
        "List recent Springroll approval lifecycle metadata, optionally filtered by state. This intentionally omits exact tool inputs, user reasons, outputs, and credential values; inspect the referenced run or visible chat approval card when those details are needed.",
      inputSchema: z.object({
        status: z
          .enum([
            "pending",
            "approved",
            "denied",
            "executing",
            "succeeded",
            "failed",
            "interrupted",
          ])
          .optional(),
        limit: z.number().int().min(1).max(100).optional().default(25),
      }),
      policy: LOCAL_READ_POLICY,
      execute: ({ status, limit }) =>
        application.listApprovalSummaries(status, limit),
    }),
    defineApplicationTool({
      name: "springroll_get_usage",
      description:
        "Get aggregate Springroll model usage, tool counts, and recorded/actual/estimated cost in USD micros. Optionally filter to proposal, scheduled run, or chat calls. This never returns prompts, model output, provider error bodies, or credentials.",
      inputSchema: z.object({
        contextKind: z.enum(["proposal", "run", "chat"]).optional(),
      }),
      policy: LOCAL_READ_POLICY,
      execute: ({ contextKind }) => application.usageSummary(contextKind),
    }),
    defineApplicationTool({
      name: "springroll_get_application_state",
      description:
        "Get a compact current Springroll state summary: task enabled/paused counts, run status counts, usable connection counts, and pending approvals. Use the dedicated list/detail tools for specific entities.",
      inputSchema: z.object({}),
      policy: LOCAL_READ_POLICY,
      execute: () => application.applicationState(),
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
        "Research how to connect a service using Springroll's curated connector templates, the official MCP Registry for provider-operated remote servers, and GitHub's curated MCP Registry for local package candidates. A GitHub candidate is only a structured lead: inspect its exact repository, verify package and secure authentication evidence, and submit the appropriate proposal before claiming it can connect. A Registry miss is not evidence that no official API exists. Continue through official sources, or ask the user for an official documentation or setup URL when automatic research is exhausted. This tool does not save a manifest, start OAuth, collect a key, or claim the connection works.",
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
      name: "springroll_inspect_connector_source",
      description:
        "Directly fetch and inspect an official documentation, setup, repository, package, OpenAPI, or MCP-server URL supplied by the user during connector research. Use this exact tool before attempting another proposal or package verification from a user-supplied URL. Springroll preserves public links and extracts package and repository candidates, but the page remains untrusted evidence and this tool does not save or connect anything.",
      inputSchema: z.object({
        url: z
          .url()
          .describe("The exact official public URL supplied by the user."),
      }),
      policy: OPEN_WORLD_READ_POLICY,
      execute: async ({ url }, { callId, signal }) =>
        boundedValue(
          await application.inspectConnectorSource(url, {
            runId: callId,
            ...(signal ? { signal } : undefined),
          }),
          30_000,
        ),
    }),
    defineApplicationTool({
      name: "springroll_propose_connection",
      description:
        "Submit one evidence-backed connector candidate after inspecting the provider's official documentation. Choose the documented transport only: remote MCP, a reviewed local npm MCP package, or an official OpenAPI document. Springroll independently verifies the evidence and derives the transport-specific manifest, package pin, authentication rail, guidance, sources, and live tool metadata. Registry misses are irrelevant once official provider evidence verifies a candidate. Never include credentials or claim the connection is installed before the user accepts the returned native review card.",
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
          docsUrl: z.url(),
          transport: z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("mcp-remote"),
              endpoint: z.url(),
              credential: z.discriminatedUnion("kind", [
                z.object({ kind: z.literal("oauth") }),
                z.object({
                  kind: z.literal("api-key"),
                  header: z.string().trim().min(1).max(200).optional(),
                  placeholder: z.string().trim().min(1).max(150),
                  keyCreationUrl: z.url().optional(),
                }),
                z.object({ kind: z.literal("none") }),
              ]),
            }),
            z.object({
              kind: z.literal("mcp-local"),
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
              logoUrl: githubLogoUrlSchema.optional(),
              logoSource: z
                .enum(["github-registry", "github-repository"])
                .optional(),
              credential: z.discriminatedUnion("kind", [
                z.object({
                  kind: z.literal("api-key"),
                  env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
                  placeholder: z.string().trim().min(1).max(150),
                  keyCreationUrl: z.url().optional(),
                }),
                z.object({ kind: z.literal("none") }),
              ]),
            }),
            z.object({
              kind: z.literal("openapi"),
              specUrl: z.url(),
              keyCreationUrl: z.url().optional(),
              credentialPlaceholder: z
                .string()
                .trim()
                .min(1)
                .max(150)
                .optional(),
              probe: z.object({
                tool: z.string().trim().min(1).max(300),
                input: z.record(z.string(), jsonValueSchema),
                note: z.string().trim().min(1).max(500),
              }),
              notes: z
                .array(z.string().trim().min(1).max(500))
                .max(6)
                .optional(),
            }),
          ]),
        })
        .superRefine(({ transport }, context) => {
          if (
            transport.kind === "mcp-local" &&
            Boolean(transport.logoUrl) !== Boolean(transport.logoSource)
          ) {
            context.addIssue({
              code: "custom",
              path: ["transport", "logoUrl"],
              message: "logoUrl and logoSource must be supplied together",
            });
          }
        }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async (
        { name, operator, description, tags, docsUrl, transport },
        { priorCalls, callId, signal },
      ) => {
        const evidenceUrls = connectorEvidenceUrls(
          docsUrl,
          transport,
          priorCalls ?? [],
        );
        switch (transport.kind) {
          case "mcp-remote":
            return boundedValue(
              await application.proposeRemoteMcpIntegration(
                {
                  name,
                  operator,
                  description,
                  ...(tags ? { tags } : {}),
                  endpoint: transport.endpoint,
                  docsUrl,
                  credential: transport.credential,
                },
                {
                  runId: callId,
                  ...(signal ? { signal } : undefined),
                },
              ),
              30_000,
            );
          case "mcp-local": {
            const review = resolveLocalMcpReviewMetadata(
              {
                name,
                packageName: transport.packageName,
                repositoryUrl: transport.repositoryUrl,
                credentialKind: transport.credential.kind,
                ...(transport.credential.kind === "api-key"
                  ? {
                      credentialPlaceholder: transport.credential.placeholder,
                      ...(transport.credential.keyCreationUrl
                        ? {
                            keyCreationUrl: transport.credential.keyCreationUrl,
                          }
                        : {}),
                    }
                  : {}),
                docsUrl,
                sourceUrls: evidenceUrls,
              },
              priorCalls ?? [],
            );
            return boundedValue(
              await application.proposeLocalMcpIntegration({
                name,
                operator,
                description,
                ...(tags ? { tags } : {}),
                packageName: transport.packageName,
                ...(transport.packageArgs
                  ? { packageArgs: transport.packageArgs }
                  : {}),
                repositoryUrl: transport.repositoryUrl,
                ...(transport.logoUrl && transport.logoSource
                  ? {
                      logo: {
                        url: transport.logoUrl,
                        source: transport.logoSource,
                        kind: "asset" as const,
                        format: transport.logoUrl.toLowerCase().includes(".svg")
                          ? ("svg" as const)
                          : ("raster" as const),
                      },
                    }
                  : {}),
                credential: transport.credential,
                guidance: {
                  summary: review.guidanceSummary,
                  steps: review.guidanceSteps,
                  docsUrl: review.docsUrl,
                },
                sources: review.sourceUrls.map((url) => ({
                  title: connectorSourceTitle(url),
                  url,
                })),
              }),
              30_000,
            );
          }
          case "openapi":
            return boundedValue(
              await application.proposeOpenApiIntegration({
                name,
                operator,
                description,
                ...(tags ? { tags } : {}),
                specUrl: transport.specUrl,
                docsUrl,
                ...(transport.keyCreationUrl
                  ? { keyCreationUrl: transport.keyCreationUrl }
                  : {}),
                ...(transport.credentialPlaceholder
                  ? {
                      credentialPlaceholder: transport.credentialPlaceholder,
                    }
                  : {}),
                probe: transport.probe,
                ...(transport.notes ? { notes: transport.notes } : {}),
                sources: evidenceUrls.map((url) => ({
                  title: connectorSourceTitle(url),
                  url,
                })),
              }),
              50_000,
            );
        }
      },
    }),
    defineApplicationTool({
      name: "springroll_propose_local_mcp",
      description:
        "Submit a local MCP package proposal only after researching the provider's MCP-specific official documentation and package repository. Never guess a package name. Springroll independently reads npm metadata, pins the exact version, requires the repository to match, and can derive review guidance and source citations from official URLs already inspected in this conversation; supply the optional guidance fields only when more precise wording is useful. If connection research returned candidate.logo, preserve its exact url and source as logoUrl and logoSource; Springroll uses it only when no exact themeable Simple Icons SVG exists. If verification misses, do not retry the same or a similar package without new official evidence; research another official source or ask the user for a documentation, repository, or package URL. Include one to three short capability tags such as analytics, email, search, or database. Preserve required non-secret packageArgs such as an mcp subcommand. Set credentialKind to none when the MCP performs its own login or uses ambient credentials; use api-key only when the MCP documentation explicitly requires an environment variable. Never include a credential value or credential-bearing argument.",
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
          logoUrl: githubLogoUrlSchema.optional(),
          logoSource: z
            .enum(["github-registry", "github-repository"])
            .optional(),
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
          guidanceSummary: z.string().trim().min(1).max(500).optional(),
          guidanceSteps: z
            .array(z.string().trim().min(1).max(500))
            .min(1)
            .max(8)
            .optional(),
          docsUrl: z.url().optional(),
          sourceUrls: z
            .array(z.url())
            .min(2)
            .max(6)
            .refine((urls) => new Set(urls).size === urls.length, {
              message: "Official source URLs must be unique",
            })
            .optional(),
        })
        .superRefine((input, context) => {
          if (
            (input.logoUrl === undefined) !==
            (input.logoSource === undefined)
          ) {
            context.addIssue({
              code: "custom",
              path: [input.logoUrl === undefined ? "logoUrl" : "logoSource"],
              message: "Logo URL and provenance must be supplied together",
            });
          }
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
      execute: async (
        {
          credentialKind,
          credentialEnv,
          credentialPlaceholder,
          keyCreationUrl,
          logoUrl,
          logoSource,
          guidanceSummary,
          guidanceSteps,
          docsUrl,
          sourceUrls,
          ...input
        },
        { priorCalls },
      ) => {
        const review = resolveLocalMcpReviewMetadata(
          {
            name: input.name,
            packageName: input.packageName,
            repositoryUrl: input.repositoryUrl,
            credentialKind,
            ...(credentialPlaceholder ? { credentialPlaceholder } : {}),
            ...(keyCreationUrl ? { keyCreationUrl } : {}),
            ...(guidanceSummary ? { guidanceSummary } : {}),
            ...(guidanceSteps ? { guidanceSteps } : {}),
            ...(docsUrl ? { docsUrl } : {}),
            ...(sourceUrls ? { sourceUrls } : {}),
          },
          priorCalls ?? [],
        );
        return boundedValue(
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
            ...(logoUrl && logoSource
              ? {
                  logo: {
                    url: logoUrl,
                    source: logoSource,
                    kind: "asset" as const,
                    format: logoUrl.toLowerCase().includes(".svg")
                      ? ("svg" as const)
                      : ("raster" as const),
                  },
                }
              : {}),
            guidance: {
              summary: review.guidanceSummary,
              steps: review.guidanceSteps,
              docsUrl: review.docsUrl,
            },
            sources: review.sourceUrls.map((url) => ({
              title: connectorSourceTitle(url),
              url,
            })),
          }),
          30_000,
        );
      },
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
        probe: z.object({
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
        "Submit a structured Springroll recipe proposal after inspecting the matching connected capability. Use the exact connectionId returned by tool description and only live tool names. Springroll deterministically validates the cron schedule, timezone, connection, tool schemas, effects, and model compatibility; it does not run another model, save, or enable the recipe. The user reviews the returned native card.",
      inputSchema: z.object({
        title: z.string().trim().min(2).max(80),
        prompt: z.string().trim().min(3).max(2_000),
        schedule: z
          .string()
          .trim()
          .min(5)
          .max(100)
          .describe("Five-field cron expression."),
        scheduleLabel: z
          .string()
          .trim()
          .min(3)
          .max(80)
          .describe("Short human-readable description of the cron schedule."),
        timezone: z.string().trim().min(1).max(100).optional(),
        connectionId: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "Exact connected ID returned by springroll_describe_connection_tools.",
          ),
        toolNames: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
        contract: z.string().trim().min(10).max(600),
        catchUpPolicy: z
          .enum(["catch_up", "skip_to_next"])
          .optional()
          .default("skip_to_next"),
      }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({ timezone, ...draft }) =>
        boundedValue(
          await application.proposeTaskDraft({
            ...draft,
            timezone:
              timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
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
      name: "springroll_propose_connection_action",
      description:
        "Draft a native confirmation card to reconnect, disconnect, or remove an installed Springroll connector. This tool never changes the connector or credentials itself. Reconnect credentials are entered only in host controls; disconnect deletes the local credential but keeps the connector; remove deletes the connector and is destructive.",
      inputSchema: z.object({
        connectionId: z.string().trim().min(1).max(200),
        action: z.enum(["reconnect", "disconnect", "remove"]),
      }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({ connectionId, action }) =>
        boundedValue(
          await application.proposeConnectionAction(connectionId, action),
          30_000,
        ),
    }),
    defineApplicationTool({
      name: "springroll_propose_task_action",
      description:
        "Draft a native confirmation card to run, pause, or resume an existing Springroll recipe. This tool never performs the action itself. Use run_now only when the user asks to execute immediately; it may spend model and connector credits. Use pause or resume only when the requested state differs from the inspected recipe.",
      inputSchema: z.object({
        taskId: z.string().trim().min(1).max(200),
        action: z.enum(["run_now", "pause", "resume"]),
      }),
      policy: OPEN_WORLD_PROPOSAL_POLICY,
      execute: async ({ taskId, action }) =>
        boundedValue(
          await application.proposeTaskAction(taskId, action),
          30_000,
        ),
    }),
    defineApplicationTool({
      name: "springroll_search_connection_tools",
      description:
        "Search every locally connected Springroll ToolSource for a capability. Returns only compact ranked connection/tool names, descriptions, and effects—never input schemas or credentials. Activate exact matches before calling or drafting with them.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100),
        limit: z.number().int().min(1).max(25).optional().default(10),
      }),
      policy: OPEN_WORLD_READ_POLICY,
      execute: ({ query, limit }) =>
        application.searchConnectionTools(query, limit),
    }),
    defineApplicationTool({
      name: "springroll_describe_connection_tools",
      description:
        "Browse one connected Springroll ToolSource on demand, including concise descriptions, JSON input schemas, and normalized read/write/destructive risk. Use a query and small limit when possible. For cross-connection discovery, search first; activate exact matches before calling or drafting with them. Output schemas are intentionally omitted; call a read tool to inspect real output.",
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
      name: "springroll_activate_connection_tools",
      description:
        "Load the exact current descriptions, JSON input schemas, and normalized risk for one to ten named tools from a connected ToolSource. Use exact names returned by search or describe. Activation only loads contracts into this conversation; it does not execute, install, authorize, or approve anything.",
      inputSchema: z.object({
        connectionId: z.string().min(1),
        toolNames: z
          .array(z.string().trim().min(1).max(300))
          .min(1)
          .max(10)
          .refine((names) => new Set(names).size === names.length, {
            message: "Tool names must be unique",
          }),
      }),
      policy: OPEN_WORLD_READ_POLICY,
      execute: ({ connectionId, toolNames }) =>
        application.activateConnectionTools(connectionId, toolNames),
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
    defineApplicationTool({
      name: "springroll_call_connection_tool",
      description:
        "Call one connected Springroll write or destructive tool. Springroll always pauses before this call and shows the exact connection, tool, and input for explicit approval. Never use it for read-only operations or claim the action happened until a tool result is returned.",
      inputSchema: z.object({
        connectionId: z.string().min(1),
        toolName: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      }),
      policy: OPEN_WORLD_MUTATION_POLICY,
      execute: async (
        { connectionId, toolName, input },
        { approved, callId, signal },
      ) => {
        if (!approved) {
          throw new Error(
            "This connection tool call requires host-controlled approval",
          );
        }
        return boundedToolResult(
          await application.callConnectionTool(
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
  ];
  return createRegistry([
    ...createApplicationCatalogDefinitions(applicationDefinitions),
    ...applicationDefinitions,
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

const undiscoverableApplicationTools = new Set([
  "springroll_propose_local_mcp",
  "springroll_propose_openapi_connection",
]);

function createApplicationCatalogDefinitions(
  definitions: readonly ApplicationToolDefinition[],
): readonly ApplicationToolDefinition[] {
  const discoverable = definitions.filter(
    ({ name }) => !undiscoverableApplicationTools.has(name),
  );
  const byName = new Map(
    discoverable.map((definition) => [definition.name, definition]),
  );
  const selectionSchema = z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(8)
    .refine((names) => new Set(names).size === names.length, {
      message: "Application tool names must be unique",
    });

  return [
    defineApplicationTool({
      name: "springroll_search_application_tools",
      description:
        "Search Springroll's own application capabilities by user goal. Returns compact names, descriptions, and policy only; activate exact matches before calling them. Use this as the escape hatch when the currently available workflow tools cannot complete the request.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(120),
        limit: z.number().int().min(1).max(12).optional().default(6),
      }),
      policy: LOCAL_READ_POLICY,
      execute: ({ query, limit }) => ({
        query,
        matches: discoverable
          .map((definition) => ({
            definition,
            score: applicationToolSearchScore(definition, query),
          }))
          .filter(({ score }) => score > 0)
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.definition.name.localeCompare(right.definition.name),
          )
          .slice(0, limit)
          .map(({ definition }) => applicationToolCatalogEntry(definition)),
      }),
    }),
    defineApplicationTool({
      name: "springroll_describe_application_tools",
      description:
        "Describe up to eight exact Springroll application tools, including their JSON input schemas and host policy. Use names returned by application-tool search. Description does not execute or approve a capability.",
      inputSchema: z.object({ toolNames: selectionSchema }),
      policy: LOCAL_READ_POLICY,
      execute: ({ toolNames }) => ({
        tools: resolveApplicationToolSelection(byName, toolNames).map(
          (definition) => ({
            ...applicationToolCatalogEntry(definition),
            inputSchema: definition.descriptor.inputSchema,
          }),
        ),
      }),
    }),
    defineApplicationTool({
      name: "springroll_activate_application_tools",
      description:
        "Activate up to eight exact Springroll application tools for the next model step. Use names returned by application-tool search. Activation changes only model-visible availability; it does not execute, authorize, approve, or mutate anything.",
      inputSchema: z.object({ toolNames: selectionSchema }),
      policy: LOCAL_READ_POLICY,
      execute: ({ toolNames }) => ({
        activatedToolNames: resolveApplicationToolSelection(
          byName,
          toolNames,
        ).map(({ name }) => name),
        instruction:
          "The exact activated tools will be available on the next model step. Call the needed tool directly using its model-visible schema.",
      }),
    }),
  ];
}

function resolveApplicationToolSelection(
  definitions: ReadonlyMap<string, ApplicationToolDefinition>,
  names: readonly string[],
): readonly ApplicationToolDefinition[] {
  return names.map((name) => {
    const definition = definitions.get(name);
    if (!definition) {
      throw new Error(
        `Unknown discoverable Springroll application tool: ${name}`,
      );
    }
    return definition;
  });
}

function applicationToolCatalogEntry(definition: ApplicationToolDefinition) {
  return {
    name: definition.name,
    description: boundedText(definition.descriptor.description, 300),
    risk: definition.policy.risk,
    approval: definition.policy.approval,
    workflow: definition.policy.workflow,
  };
}

function applicationToolSearchScore(
  definition: ApplicationToolDefinition,
  query: string,
): number {
  const normalizedQuery = normalizeApplicationToolSearchText(query);
  const terms = normalizedQuery.split(" ").filter((term) => term.length > 1);
  if (terms.length === 0) return 0;
  const name = normalizeApplicationToolSearchText(definition.name);
  const description = normalizeApplicationToolSearchText(
    definition.descriptor.description,
  );
  return terms.reduce(
    (score, term) =>
      score +
      (name === term ? 12 : name.includes(term) ? 6 : 0) +
      (description.includes(term) ? 2 : 0),
    0,
  );
}

function normalizeApplicationToolSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/^springroll_/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function resolveLocalMcpReviewMetadata(
  input: {
    readonly name: string;
    readonly packageName: string;
    readonly repositoryUrl: string;
    readonly credentialKind: "api-key" | "none";
    readonly credentialPlaceholder?: string;
    readonly keyCreationUrl?: string;
    readonly guidanceSummary?: string;
    readonly guidanceSteps?: readonly string[];
    readonly docsUrl?: string;
    readonly sourceUrls?: readonly string[];
  },
  priorCalls: readonly ApplicationToolCall[],
) {
  const inspectedUrls = Array.from(
    new Set(
      priorCalls.flatMap((call) => {
        if (
          call.name !== "springroll_inspect_connector_source" ||
          !isUnknownObject(call.input) ||
          typeof call.input.url !== "string"
        ) {
          return [];
        }
        try {
          return [new URL(call.input.url).toString()];
        } catch {
          return [];
        }
      }),
    ),
  );
  const canDerive =
    inspectedUrls.length > 0 ||
    Boolean(input.docsUrl && input.sourceUrls && input.sourceUrls.length >= 2);
  const derivedDocsUrl = canDerive
    ? ([...inspectedUrls]
        .filter((url) => url !== input.repositoryUrl)
        .sort(
          (left, right) =>
            connectorDocumentationScore(right) -
            connectorDocumentationScore(left),
        )[0] ??
      input.keyCreationUrl ??
      input.repositoryUrl)
    : undefined;
  const credentialLabel =
    input.credentialPlaceholder?.trim() || "documented API credential";
  const guidanceSummary = canDerive
    ? input.credentialKind === "api-key"
      ? `Connect ${input.name} through the verified ${input.packageName} package using its documented ${credentialLabel}.`
      : `Connect ${input.name} through the verified ${input.packageName} package using its documented sign-in or ambient credentials.`
    : undefined;
  const guidanceSteps = canDerive
    ? input.credentialKind === "api-key"
      ? [
          `Open the official setup documentation and create the ${credentialLabel}.`,
          "Enter it in Springroll's secure credential control; never paste it into chat.",
          `Review the pinned ${input.packageName} package before Springroll launches it.`,
        ]
      : [
          `Review the pinned ${input.packageName} package before Springroll launches it.`,
          "Complete the package's documented sign-in when prompted.",
        ]
    : undefined;
  const sourceUrls = canDerive
    ? Array.from(
        new Set(
          [input.repositoryUrl, derivedDocsUrl, ...inspectedUrls].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ).slice(0, 6)
    : undefined;

  return localMcpReviewMetadataSchema.parse({
    guidanceSummary: input.guidanceSummary ?? guidanceSummary,
    guidanceSteps: input.guidanceSteps ?? guidanceSteps,
    docsUrl: input.docsUrl ?? derivedDocsUrl,
    sourceUrls: input.sourceUrls ?? sourceUrls,
  });
}

function connectorDocumentationScore(value: string): number {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return (
    (hostname.startsWith("learn.") || hostname.startsWith("docs.") ? 100 : 0) +
    (!hostname.includes("github") ? 40 : 0) +
    (/\b(?:docs?|learn|setup|install|api)\b/.test(path) ? 30 : 0) -
    (hostname === "raw.githubusercontent.com" ? 20 : 0) -
    (/\/(?:blob|raw)\//.test(path) ? 10 : 0)
  );
}

function connectorSourceTitle(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/$/, "");
  return path
    ? `${url.hostname}${path}`.slice(0, 200)
    : url.hostname.slice(0, 200);
}

function connectorEvidenceUrls(
  docsUrl: string,
  transport:
    | { readonly kind: "mcp-remote"; readonly endpoint: string }
    | { readonly kind: "mcp-local"; readonly repositoryUrl: string }
    | { readonly kind: "openapi"; readonly specUrl: string },
  priorCalls: readonly ApplicationToolCall[],
): readonly string[] {
  const inspectedUrls = priorCalls.flatMap((call) => {
    if (
      call.name !== "springroll_inspect_connector_source" ||
      !isUnknownObject(call.input) ||
      typeof call.input.url !== "string"
    ) {
      return [];
    }
    try {
      return [new URL(call.input.url).toString()];
    } catch {
      return [];
    }
  });
  const transportUrl =
    transport.kind === "mcp-local"
      ? transport.repositoryUrl
      : transport.kind === "openapi"
        ? transport.specUrl
        : transport.endpoint;
  return Array.from(
    new Set(
      [docsUrl, transportUrl, ...inspectedUrls].map((value) =>
        new URL(value).toString(),
      ),
    ),
  ).slice(0, 6);
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
