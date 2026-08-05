import {
  AgentRunExecutor,
  type AgentRunner,
  type AppDatabase,
  authorizeRemoteMcp,
  type Connection,
  type ConnectorManifest,
  type ConnectorOAuthClientProvider,
  ConnectorOAuthCredentialProvider,
  type CredentialStore,
  connections,
  connectorAvailableIn,
  createLocalMcpToolSource,
  createOpenApiToolSource,
  createRemoteMcpToolSource,
  type FetchApi,
  hashToolSchema,
  InvalidConnectorOAuthCredentialError,
  integrationManifests,
  type JsonObject,
  modelProviderConnections,
  modelSettings,
  nextCronRun,
  OpenAiModelConnection,
  type OpenRouterModelConnection,
  type ProviderToolCapability,
  parseConnectorManifest,
  requiredProviderToolCapabilities,
  runEvents,
  runs,
  type ToolDescriptor,
  type ToolResult,
  type ToolSource,
  tasks,
  taskTools,
  verifyExaCredential,
  XaiModelConnection,
} from "@springroll/kernel";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type {
  AppSnapshotDto,
  CatchUpPolicy,
  ConnectionCardDto,
  ConnectionDetailDto,
  ConnectorOAuthStartDto,
  IntegrationProposalOutcomeDto,
  ModelExecutionDto,
  ModelProviderDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelSettingsDto,
  RunDetailDto,
  RunEventDto,
  RunEventPageDto,
  RunStartDto,
  RunStatus,
  RunSummaryDto,
  TaskProposalDto,
  TaskProposalOutcomeDto,
  TaskSummaryDto,
} from "../shared.ts";
import { resolveBrandLogoSvg } from "./brand-logos.ts";
import {
  connectorTemplate,
  connectorTemplateMetadata,
  matchConnectorTemplate,
} from "./connector-templates.ts";
import type {
  IntegrationResearcher,
  LocalMcpIntegrationResearcher,
  LocalMcpResearchInput,
  ResearchedIntegration,
} from "./integration-researcher.ts";
import { connectorCapabilityTags } from "./integration-researcher.ts";
import type { ModelsDevCatalog } from "./model-catalog.ts";
import type {
  GeneratedTaskProposal,
  ProposalConnectionOption,
  TaskProposalGenerator,
} from "./proposal-generator.ts";
import {
  connectionLogoSeeds,
  providerLogoSeeds,
  sanitizeProviderLogo,
} from "./provider-logos.ts";
import {
  connectorRegistryManifests,
  createManifestToolSources,
  createNeonConnectorManifest,
  createWebToolSource,
  exaCredentialRef,
  neonConnectionId,
  neonCredentialRef,
  openAiCredentialRef,
  openRouterCredentialRef,
  readUrl,
  webConnectionId,
  webSourceId,
  xaiCredentialRef,
} from "./sources.ts";

export interface LocalApplicationOptions {
  readonly credentials: CredentialStore;
  readonly models: OpenRouterModelConnection;
  readonly openAiModels?: OpenAiModelConnection;
  readonly xaiModels?: XaiModelConnection;
  readonly modelCatalog?: Pick<ModelsDevCatalog, "read"> &
    Partial<Pick<ModelsDevCatalog, "logos">>;
  readonly agent: AgentRunner;
  readonly resolveModelExecution?: ResolveModelExecution;
  readonly proposalGenerator: TaskProposalGenerator;
  readonly integrationResearcher?: IntegrationResearcher;
  readonly localMcpResearcher?: LocalMcpIntegrationResearcher;
  readonly now?: () => Date;
  readonly extraToolSources?: readonly ToolSource[];
  readonly connectorRegistry?: readonly ConnectorManifest[];
  readonly fetch?: FetchApi;
}

export type ResolveModelExecution = (
  taskSelection:
    | { readonly providerId: string; readonly modelId: string }
    | undefined,
  requiredCapabilities: readonly ProviderToolCapability[],
) => Promise<ModelExecutionDto>;

export interface UpdateTaskInput {
  readonly enabled?: boolean;
  readonly tag?: string | null;
  readonly catchUpPolicy?: CatchUpPolicy;
  readonly modelSelection?: ModelSelectionDto | null;
}

export type DeleteRecordResult = "deleted" | "not_found" | "active";

export interface AssistantConnectionToolDescription {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: JsonObject;
    readonly outputSchema?: JsonObject;
    readonly risk: {
      readonly effect: "read" | "write" | "destructive";
      readonly openWorld: boolean;
      readonly idempotent: boolean;
    };
  }[];
}

export interface AssistantConnectionToolCallContext {
  readonly runId?: string;
  readonly signal?: AbortSignal;
}

export class LocalApplication {
  readonly #credentials: CredentialStore;
  readonly #models: OpenRouterModelConnection;
  readonly #openAiModels: OpenAiModelConnection;
  readonly #xaiModels: XaiModelConnection;
  readonly #modelCatalog: LocalApplicationOptions["modelCatalog"];
  readonly #proposalGenerator: TaskProposalGenerator;
  readonly #integrationResearcher: IntegrationResearcher | undefined;
  readonly #localMcpResearcher: LocalMcpIntegrationResearcher | undefined;
  readonly #resolveModelExecution: ResolveModelExecution | undefined;
  readonly #now: () => Date;
  readonly #fetch: FetchApi;
  readonly #connectorRegistry: ReadonlyMap<string, ConnectorManifest>;
  readonly #sources: Map<string, ToolSource>;
  readonly #executor: AgentRunExecutor;
  readonly #manualRuns = new Map<string, Promise<RunStartDto>>();
  readonly #researchedIntegrations = new Map<string, ResearchedIntegration>();

  constructor(
    private readonly db: AppDatabase,
    options: LocalApplicationOptions,
  ) {
    this.#credentials = options.credentials;
    this.#models = options.models;
    this.#openAiModels =
      options.openAiModels ?? new OpenAiModelConnection(options.credentials);
    this.#xaiModels =
      options.xaiModels ?? new XaiModelConnection(options.credentials);
    this.#modelCatalog = options.modelCatalog;
    this.#proposalGenerator = options.proposalGenerator;
    this.#integrationResearcher = options.integrationResearcher;
    this.#localMcpResearcher = options.localMcpResearcher;
    this.#resolveModelExecution = options.resolveModelExecution;
    this.#now = options.now ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#connectorRegistry = new Map(
      (options.connectorRegistry ?? connectorRegistryManifests).map(
        (manifest) => {
          const parsed = parseConnectorManifest(manifest);
          return [parsed.id, parsed] as const;
        },
      ),
    );
    this.#sources = new Map(
      [
        createWebToolSource(options.credentials, options.fetch),
        ...createManifestToolSources(
          (manifestId) => this.connectorManifest(manifestId),
          options.credentials,
          options.fetch,
          (manifest, connection) =>
            this.connectorOAuthProvider(manifest, connection),
        ),
        ...(options.extraToolSources ?? []),
      ].map((source) => [source.id, source]),
    );
    this.#executor = new AgentRunExecutor(db, {
      agent: options.agent,
      getToolSource: (sourceId) => this.#sources.get(sourceId),
    });
  }

  get executor(): AgentRunExecutor {
    return this.#executor;
  }

  getToolSource(sourceId: string): ToolSource | undefined {
    return this.#sources.get(sourceId);
  }

  async describeConnectionTools(
    connectionReference: string,
    query?: string,
    limit = 20,
  ): Promise<AssistantConnectionToolDescription> {
    const selected = this.assistantConnection(connectionReference);
    const source = this.#sources.get(selected.connection.sourceId);
    if (!source) {
      throw new Error(
        `Unknown connection source: ${selected.connection.sourceId}`,
      );
    }
    const session = await source.open({
      connection: selected.connection,
      location: "local",
    });
    try {
      const normalizedQuery = query?.trim().toLocaleLowerCase();
      const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
      return {
        connectionId: selected.connection.id,
        connectionName: selected.name,
        tools: (await session.listTools())
          .filter(
            (descriptor) =>
              !normalizedQuery ||
              descriptor.name.toLocaleLowerCase().includes(normalizedQuery) ||
              descriptor.description
                .toLocaleLowerCase()
                .includes(normalizedQuery),
          )
          .slice(0, boundedLimit)
          .map((descriptor) => ({
            name: descriptor.name,
            description: descriptor.description,
            inputSchema: descriptor.inputSchema,
            ...(descriptor.outputSchema
              ? { outputSchema: descriptor.outputSchema }
              : undefined),
            risk: normalizedRisk(descriptor),
          })),
      };
    } finally {
      await session.close();
    }
  }

  async callReadConnectionTool(
    connectionReference: string,
    toolName: string,
    input: JsonObject,
    context: AssistantConnectionToolCallContext = {},
  ): Promise<ToolResult> {
    const selected = this.assistantConnection(connectionReference);
    const source = this.#sources.get(selected.connection.sourceId);
    if (!source) {
      throw new Error(
        `Unknown connection source: ${selected.connection.sourceId}`,
      );
    }
    const session = await source.open({
      connection: selected.connection,
      location: "local",
    });
    try {
      const descriptor = (await session.listTools()).find(
        (candidate) => candidate.name === toolName,
      );
      if (!descriptor) {
        throw new TypeError(
          `Connection tool is unavailable: ${selected.connection.id}/${toolName}`,
        );
      }
      if (normalizedRisk(descriptor).effect !== "read") {
        throw new TypeError(
          `Connection tool requires proposal and approval: ${selected.connection.id}/${toolName}`,
        );
      }
      return await session.callTool(toolName, input, {
        taskId: "interactive-assistant",
        runId: context.runId ?? crypto.randomUUID(),
        ...(context.signal ? { signal: context.signal } : undefined),
      });
    } finally {
      await session.close();
    }
  }

  ensureBuiltinConnections(): void {
    this.db.transaction((transaction) => {
      transaction
        .insert(connections)
        .values({
          id: webConnectionId,
          name: "Web",
          sourceId: webSourceId,
          credentialRef: exaCredentialRef,
          config: {},
          availableIn: ["local"],
        })
        .onConflictDoNothing({
          target: connections.id,
        })
        .run();
    });
  }

  private assistantConnection(connectionReference: string): {
    readonly connection: Connection;
    readonly name: string;
  } {
    const normalized = connectionReference.trim();
    if (!normalized) throw new TypeError("Connection ID is required");
    const rows = this.db
      .select()
      .from(connections)
      .all()
      .filter((row) => row.config.disconnected !== true);
    const row =
      rows.find((candidate) => candidate.id === normalized) ??
      rows.find((candidate) => candidate.manifestId === normalized) ??
      (normalized === "web-search"
        ? rows.find((candidate) => candidate.id === webConnectionId)
        : undefined);
    if (!row) throw new TypeError(`Connection is unavailable: ${normalized}`);
    if (!row.availableIn.includes("local")) {
      throw new TypeError(`Connection is not available locally: ${normalized}`);
    }
    return {
      connection: {
        id: row.id,
        sourceId: row.sourceId,
        ...(row.manifestId ? { manifestId: row.manifestId } : undefined),
        credentialRef: row.credentialRef,
        availableIn: row.availableIn,
        config: row.config,
      },
      name: row.name ?? humanizeSource(row.sourceId),
    };
  }

  async snapshot(): Promise<AppSnapshotDto> {
    const [runRows, taskRows, connectionRows] = await Promise.all([
      this.listRuns(),
      this.listTasks(),
      this.listConnections(),
    ]);

    return {
      runs: runRows,
      tasks: taskRows,
      connections: connectionRows,
    };
  }

  async listRuns(): Promise<readonly RunSummaryDto[]> {
    return this.db
      .select({
        id: runs.id,
        taskId: runs.taskId,
        taskName: tasks.name,
        prompt: tasks.prompt,
        status: runs.status,
        scheduledTime: runs.scheduledTime,
        summary: runs.transcriptSummary,
        error: runs.error,
      })
      .from(runs)
      .innerJoin(tasks, eq(runs.taskId, tasks.id))
      .orderBy(desc(runs.scheduledTime))
      .limit(100)
      .all()
      .map(toRunSummary);
  }

  async getRun(runId: string): Promise<RunDetailDto | undefined> {
    const row = this.db
      .select({
        id: runs.id,
        taskId: runs.taskId,
        taskName: tasks.name,
        prompt: tasks.prompt,
        status: runs.status,
        scheduledTime: runs.scheduledTime,
        summary: runs.transcriptSummary,
        body: runs.transcriptBody,
        result: runs.resultJson,
        error: runs.error,
        executionLocation: runs.executionLocation,
        startedAt: runs.startedAt,
        finishedAt: runs.finishedAt,
        durationMs: runs.durationMs,
        modelProvider: runs.modelProvider,
        modelId: runs.modelId,
        modelBilling: runs.modelBilling,
        inputTokens: runs.inputTokens,
        outputTokens: runs.outputTokens,
        reasoningTokens: runs.reasoningTokens,
        cachedInputTokens: runs.cachedInputTokens,
        totalTokens: runs.totalTokens,
        costUsdMicros: runs.costUsdMicros,
        actualCostUsdMicros: runs.actualCostUsdMicros,
        estimatedCostUsdMicros: runs.estimatedCostUsdMicros,
        costSource: runs.costSource,
        webSearchRequests: runs.webSearchRequests,
        catalogRevision: runs.catalogRevision,
      })
      .from(runs)
      .innerJoin(tasks, eq(runs.taskId, tasks.id))
      .where(eq(runs.id, runId))
      .get();

    if (!row) {
      return undefined;
    }

    const toolCallRows = this.db
      .select({ id: runEvents.id })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "tool_call")))
      .all();
    const observedProviderToolCalls = this.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "usage")))
      .all()
      .reduce(
        (total, event) =>
          total +
          (typeof event.payload.providerToolCalls === "number"
            ? event.payload.providerToolCalls
            : 0),
        0,
      );

    return {
      ...toRunSummary(row),
      ...(row.body ? { body: row.body } : undefined),
      ...(row.result ? { result: row.result } : undefined),
      executionLocation: row.executionLocation,
      ...(row.startedAt
        ? { startedAt: row.startedAt.toISOString() }
        : undefined),
      ...(row.finishedAt
        ? { finishedAt: row.finishedAt.toISOString() }
        : undefined),
      ...(row.durationMs === null ? undefined : { durationMs: row.durationMs }),
      ...(row.modelProvider === null
        ? undefined
        : { modelProvider: row.modelProvider }),
      ...(row.modelId === null ? undefined : { modelId: row.modelId }),
      ...(row.modelBilling === null
        ? undefined
        : { modelBilling: row.modelBilling }),
      ...(row.inputTokens === null
        ? undefined
        : { inputTokens: row.inputTokens }),
      ...(row.outputTokens === null
        ? undefined
        : { outputTokens: row.outputTokens }),
      ...(row.reasoningTokens === null
        ? undefined
        : { reasoningTokens: row.reasoningTokens }),
      ...(row.cachedInputTokens === null
        ? undefined
        : { cachedInputTokens: row.cachedInputTokens }),
      ...(row.totalTokens === null
        ? undefined
        : { totalTokens: row.totalTokens }),
      ...(row.costUsdMicros === null
        ? undefined
        : { costUsdMicros: row.costUsdMicros }),
      ...(row.actualCostUsdMicros === null
        ? undefined
        : { actualCostUsdMicros: row.actualCostUsdMicros }),
      ...(row.estimatedCostUsdMicros === null
        ? undefined
        : { estimatedCostUsdMicros: row.estimatedCostUsdMicros }),
      ...(row.costSource === null ? undefined : { costSource: row.costSource }),
      ...(row.webSearchRequests === null
        ? undefined
        : { webSearchRequests: row.webSearchRequests }),
      ...(row.catalogRevision === null
        ? undefined
        : { catalogRevision: row.catalogRevision }),
      toolCalls:
        toolCallRows.length +
        (row.webSearchRequests ?? observedProviderToolCalls),
    };
  }

  async deleteRun(runId: string): Promise<DeleteRecordResult> {
    return this.db.transaction((transaction) => {
      const run = transaction
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      if (!run) {
        return "not_found";
      }
      if (run.status === "claimed" || run.status === "running") {
        return "active";
      }

      transaction.delete(runs).where(eq(runs.id, runId)).run();
      return "deleted";
    });
  }

  async listRunEvents(
    runId: string,
    after = -1,
    limit = 100,
  ): Promise<RunEventPageDto | undefined> {
    const run = this.db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    if (!run) {
      return undefined;
    }

    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, after)))
      .orderBy(asc(runEvents.sequence))
      .limit(boundedLimit + 1)
      .all();
    const hasMore = rows.length > boundedLimit;
    const pageRows = rows.slice(0, boundedLimit);
    const events = pageRows.map(toSafeRunEvent);

    return {
      runId,
      runStatus: run.status,
      events,
      nextCursor: events.at(-1)?.sequence ?? after,
      hasMore,
    };
  }

  async listTasks(): Promise<readonly TaskSummaryDto[]> {
    const taskRows = this.db
      .select()
      .from(tasks)
      .orderBy(desc(tasks.createdAt))
      .all();
    const toolRows = this.db
      .select({
        taskId: taskTools.taskId,
        connectionName: connections.name,
        sourceId: connections.sourceId,
      })
      .from(taskTools)
      .innerJoin(connections, eq(taskTools.connectionId, connections.id))
      .all();
    const namesByTask = new Map<string, Set<string>>();

    for (const tool of toolRows) {
      const names = namesByTask.get(tool.taskId) ?? new Set<string>();
      names.add(tool.connectionName ?? humanizeSource(tool.sourceId));
      namesByTask.set(tool.taskId, names);
    }

    const recentRunRows = this.db
      .select({ taskId: runs.taskId, status: runs.status })
      .from(runs)
      .orderBy(desc(runs.scheduledTime))
      .limit(200)
      .all();
    const recentStatusesByTask = new Map<string, RunStatus[]>();
    for (const run of recentRunRows) {
      const statuses = recentStatusesByTask.get(run.taskId) ?? [];
      if (statuses.length < 7) {
        statuses.push(run.status);
        recentStatusesByTask.set(run.taskId, statuses);
      }
    }

    return taskRows.map((task) => ({
      id: task.id,
      name: task.name ?? taskName(task.prompt),
      ...(task.tag ? { tag: task.tag } : undefined),
      prompt: task.prompt,
      schedule: task.schedule,
      timezone: task.scheduleTimezone,
      enabled: task.enabled,
      catchUpPolicy: task.catchUpPolicy,
      nextRunAt: task.nextRunAt.toISOString(),
      connectionNames: [...(namesByTask.get(task.id) ?? [])],
      recentRunStatuses: [
        ...(recentStatusesByTask.get(task.id) ?? []),
      ].reverse(),
      ...(task.modelProviderId && task.modelId
        ? {
            modelOverride: {
              providerId: task.modelProviderId as ModelProviderId,
              modelId: task.modelId,
            },
          }
        : undefined),
    }));
  }

  async getTask(taskId: string): Promise<TaskSummaryDto | undefined> {
    return (await this.listTasks()).find((task) => task.id === taskId);
  }

  async deleteTask(taskId: string): Promise<DeleteRecordResult> {
    return this.db.transaction((transaction) => {
      const task = transaction
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get();
      if (!task) {
        return "not_found";
      }
      const activeRun = transaction
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.taskId, taskId),
            inArray(runs.status, ["claimed", "running"]),
          ),
        )
        .get();
      if (activeRun) {
        return "active";
      }

      transaction.delete(tasks).where(eq(tasks.id, taskId)).run();
      return "deleted";
    });
  }

  async proposeTask(
    sentence: string,
    timezone: string,
  ): Promise<TaskProposalOutcomeDto> {
    const normalizedSentence = sentence.trim();
    if (normalizedSentence.length < 3 || normalizedSentence.length > 2_000) {
      throw new TypeError("Describe the task in 3 to 2,000 characters");
    }

    const catalog = await this.connectionCatalog();
    const generated = await this.#proposalGenerator.propose({
      sentence: normalizedSentence,
      timezone,
      connections: catalog.map(toProposalConnectionOption),
    });

    if (generated.status !== "ready") {
      return normalizeUnavailableProposal(generated);
    }

    const proposal = this.validateAndEnrichProposal(
      generated.proposal,
      catalog,
    );
    if (!this.#resolveModelExecution) {
      return { status: "ready", proposal };
    }

    return {
      status: "ready",
      proposal: {
        ...proposal,
        modelExecution: await this.#resolveModelExecution(
          undefined,
          proposalProviderCapabilities(proposal, catalog),
        ),
      },
    };
  }

  async createTask(
    proposal: TaskProposalDto,
    enabled: boolean,
    options: { readonly id?: string } = {},
  ): Promise<TaskSummaryDto> {
    if (options.id) {
      const existing = await this.getTask(options.id);
      if (existing) return existing;
    }
    const catalog = await this.connectionCatalog();
    const validated = this.validateAndEnrichProposal(proposal, catalog);
    const connection = catalog.find(
      (option) => option.connection.id === validated.connectionId,
    );
    if (!connection) {
      throw new TypeError("The selected connection is no longer available");
    }

    const descriptors = new Map(
      connection.tools.map((tool) => [tool.name, tool]),
    );
    const id = options.id ?? crypto.randomUUID();
    const now = this.#now();
    const nextRunAt = nextCronRun(validated.schedule, validated.timezone, now);
    const pins = await Promise.all(
      validated.toolNames.map(async (name) => {
        const descriptor = descriptors.get(name);
        if (!descriptor) {
          throw new TypeError(
            `The selected tool is no longer available: ${name}`,
          );
        }
        const risk = normalizedRisk(descriptor);

        return {
          taskId: id,
          connectionId: connection.connection.id,
          sourceId: connection.connection.sourceId,
          name,
          inputSchemaHash: await hashToolSchema(descriptor.inputSchema),
          riskEffect: risk.effect,
          riskOpenWorld: risk.openWorld,
          riskIdempotent: risk.idempotent,
          approval:
            risk.effect === "read"
              ? ("never" as const)
              : ("before_call" as const),
        };
      }),
    );

    this.db.transaction((transaction) => {
      transaction
        .insert(tasks)
        .values({
          id,
          name: validated.title,
          prompt: validated.prompt,
          schedule: validated.schedule,
          scheduleTimezone: validated.timezone,
          enabled,
          catchUpPolicy: validated.catchUpPolicy,
          nextRunAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      transaction.insert(taskTools).values(pins).run();
    });

    const created = await this.getTask(id);
    if (!created) {
      throw new Error("The task was created but could not be read");
    }

    return created;
  }

  async updateTask(
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskSummaryDto | undefined> {
    const update = {
      ...(input.enabled === undefined ? undefined : { enabled: input.enabled }),
      ...(input.tag === undefined
        ? undefined
        : { tag: input.tag?.trim() || null }),
      ...(input.catchUpPolicy === undefined
        ? undefined
        : { catchUpPolicy: input.catchUpPolicy }),
      ...(input.modelSelection === undefined
        ? undefined
        : {
            modelProviderId: input.modelSelection?.providerId ?? null,
            modelId: input.modelSelection?.modelId ?? null,
          }),
      updatedAt: this.#now(),
    };
    if (input.modelSelection) {
      await this.assertSelectableModel(input.modelSelection);
    }
    const changed = this.db
      .update(tasks)
      .set(update)
      .where(eq(tasks.id, taskId))
      .returning({ id: tasks.id })
      .get();

    return changed ? this.getTask(taskId) : undefined;
  }

  async runTaskNow(
    taskId: string,
    manualRequestId?: string,
  ): Promise<RunStartDto> {
    if (manualRequestId) {
      const existing = this.db
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.taskId, taskId),
            eq(runs.manualRequestId, manualRequestId),
          ),
        )
        .get();
      if (existing) {
        return { id: existing.id };
      }
    }

    const active = this.#manualRuns.get(taskId);
    if (active) {
      return active;
    }

    const pending = this.startManualRun(taskId, manualRequestId);
    this.#manualRuns.set(taskId, pending);

    try {
      return await pending;
    } catch (error) {
      if (this.#manualRuns.get(taskId) === pending) {
        this.#manualRuns.delete(taskId);
      }
      throw error;
    }
  }

  private async startManualRun(
    taskId: string,
    manualRequestId?: string,
  ): Promise<RunStartDto> {
    const task = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    if (!task) {
      throw new TypeError("The task no longer exists");
    }

    if (this.#resolveModelExecution) {
      await this.getTaskExecution(taskId);
    }

    const scheduledTime = this.#now();
    const runId = crypto.randomUUID();
    this.db
      .insert(runs)
      .values({
        id: runId,
        taskId,
        scheduledTime,
        ...(manualRequestId ? { manualRequestId } : undefined),
        status: "claimed",
        executionLocation: "local",
      })
      .run();
    const execution = this.#executor.execute(runId, taskId, scheduledTime);
    void execution.then(
      () => this.#manualRuns.delete(taskId),
      () => this.#manualRuns.delete(taskId),
    );

    return { id: runId };
  }

  async getTaskExecution(taskId: string): Promise<ModelExecutionDto> {
    if (!this.#resolveModelExecution) {
      throw new Error("Model execution preview is not configured");
    }
    const task = this.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) {
      throw new TypeError("The task no longer exists");
    }

    try {
      const descriptors = await this.taskToolDescriptors(taskId);
      return await this.#resolveModelExecution(
        task.modelProviderId && task.modelId
          ? {
              providerId: task.modelProviderId,
              modelId: task.modelId,
            }
          : undefined,
        requiredProviderToolCapabilities(
          descriptors.map((descriptor) => ({ descriptor })),
        ),
      );
    } catch (error) {
      throw new TypeError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  async listConnections(): Promise<readonly ConnectionCardDto[]> {
    const portableWebConnected = Boolean(
      await this.#credentials.get(exaCredentialRef),
    );

    const webSearchCards: readonly ConnectionCardDto[] = [
      {
        id: "web-search",
        category: "web-search",
        name: "Exa",
        description:
          "Built-in public web search and page reading for every model.",
        tags: ["search", "web"],
        status: "connected",
        credentialConfigured: portableWebConnected,
        keyCreationUrl: "https://dashboard.exa.ai/api-keys",
      },
      {
        id: "google-search",
        category: "web-search",
        name: "Google",
        description:
          "Gemini-native Google Search grounding when Google models arrive.",
        tags: ["search", "web"],
        status: "coming_soon",
      },
      {
        id: "tavily",
        category: "web-search",
        name: "Tavily",
        description: "Agent-oriented search and page extraction.",
        tags: ["search", "web"],
        status: "coming_soon",
      },
      {
        id: "parallel",
        category: "web-search",
        name: "Parallel",
        description: "Fast agent search with structured web context.",
        tags: ["search", "web"],
        status: "coming_soon",
      },
      {
        id: "firecrawl",
        category: "web-search",
        name: "Firecrawl",
        description: "Search, scrape, and read sites that require rendering.",
        tags: ["search", "web"],
        status: "coming_soon",
      },
    ];

    const connectionByManifest = new Map(
      this.db
        .select()
        .from(connections)
        .all()
        .filter((connection) => connection.manifestId !== null)
        .map((connection) => [connection.manifestId, connection]),
    );
    const connectorCards = Array.from(
      this.connectorManifests().values(),
      (manifest): ConnectionCardDto => {
        const connection = connectionByManifest.get(manifest.id);
        const toolCount = connection?.config.toolCount;
        const manifestLogo = manifest.logoSvg
          ? sanitizeProviderLogo(manifest.logoSvg)
          : undefined;
        const registryMetadata = connectorTemplateMetadata.get(manifest.id);
        const tags =
          manifest.tags ??
          connectorCapabilityTags(undefined, manifest.name, manifest.blurb);
        const manifestTools = manifest.tools?.allow?.map((name) => ({
          name,
          effect: manifest.tools?.risk?.[name]?.effect ?? ("write" as const),
        }));
        const discoveredTools = readDiscoveredTools(
          connection?.config.discoveredTools,
        );
        const cardTools = discoveredTools ?? manifestTools;
        return {
          id: manifest.id,
          category: "connector",
          name: manifest.name,
          description: manifestDescription(manifest.blurb),
          status:
            connection && connection.config.disconnected !== true
              ? "connected"
              : "not_connected",
          endpoint:
            manifest.transport.kind === "mcp-remote"
              ? manifest.transport.endpoint
              : manifest.transport.kind === "mcp-local"
                ? `npm:${manifest.transport.package.name}@${manifest.transport.package.version}`
                : manifest.transport.baseUrl,
          connectionType:
            manifest.transport.kind === "mcp-local"
              ? "local"
              : manifest.transport.kind === "openapi"
                ? "api"
                : "mcp",
          custom: !this.#connectorRegistry.has(manifest.id),
          installed: connection !== undefined,
          removable: !this.#connectorRegistry.has(manifest.id),
          ...(tags.length ? { tags } : undefined),
          ...(typeof toolCount === "number" ? { toolCount } : undefined),
          ...(cardTools
            ? { tools: cardTools, toolCount: cardTools.length }
            : undefined),
          credentialKind: manifest.credential.kind,
          ...(manifest.credential.kind === "api-key"
            ? { credentialPlaceholder: manifest.credential.placeholder }
            : undefined),
          ...(registryMetadata
            ? {
                operator: registryMetadata.operator,
                featured: registryMetadata.featured,
                actionable: registryMetadata.actionable,
                ...(registryMetadata.setupVariantId
                  ? { setupVariantId: registryMetadata.setupVariantId }
                  : {}),
              }
            : {
                operator: this.#connectorRegistry.has(manifest.id)
                  ? manifest.name
                  : "Custom manifest",
              }),
          ...(manifest.credential.kind === "oauth"
            ? { oauthReady: registryMetadata?.oauthReady ?? true }
            : {}),
          availableIn: connectorAvailableIn(manifest),
          ...(manifest.credential.kind === "api-key" &&
          manifest.credential.keyCreationUrl
            ? { keyCreationUrl: manifest.credential.keyCreationUrl }
            : undefined),
          ...(manifestLogo ? { logoSvg: manifestLogo } : undefined),
        };
      },
    );

    return [...webSearchCards, ...connectorCards].map((card) => {
      if (card.logoSvg) return card;
      const logoSvg =
        connectionLogoSeeds[card.id] ??
        resolveBrandLogoSvg(card.name, card.operator);
      return logoSvg ? { ...card, logoSvg } : card;
    });
  }

  async getConnectionDetail(
    connectionReference: string,
  ): Promise<ConnectionDetailDto | undefined> {
    const card = (await this.listConnections()).find(
      (candidate) => candidate.id === connectionReference,
    );
    if (!card) return undefined;

    let catalogSource: ConnectionDetailDto["catalogSource"] = card.tools?.length
      ? "last-discovered"
      : "unavailable";
    let tools = card.tools ?? [];
    if (card.status === "connected") {
      try {
        const selected = this.assistantConnection(connectionReference);
        const source = this.#sources.get(selected.connection.sourceId);
        if (source) {
          const session = await source.open({
            connection: selected.connection,
            location: "local",
          });
          try {
            tools = (await session.listTools()).map((descriptor) => ({
              name: descriptor.name,
              description: descriptor.description,
              effect: normalizedRisk(descriptor).effect,
            }));
            catalogSource = "live";
          } finally {
            await session.close();
          }
        }
      } catch {
        // A detail page remains useful while a remote service is temporarily
        // unavailable. In that case, show the last safely discovered catalog.
      }
    }

    return {
      ...card,
      catalogSource,
      tools,
      ...(tools.length || card.toolCount !== undefined
        ? { toolCount: tools.length || card.toolCount }
        : undefined),
      agentAccess: {
        mode: "on-demand",
        catalogIncludes: "names-and-effects",
        detailIncludes: "descriptions-and-schemas",
        directEffects: ["read"],
        approvalEffects: ["write", "destructive"],
      },
    };
  }

  async modelConfiguration(): Promise<ModelSettingsDto> {
    const logos = (await this.#modelCatalog?.logos?.()) ?? providerLogoSeeds;
    const providers = (await this.listModelProviders()).map((provider) => ({
      ...provider,
      logoSvg: logos[provider.id],
    }));
    const active = new Set(
      providers
        .filter((provider) => provider.status === "connected")
        .map((provider) => provider.id),
    );
    const catalog = this.#modelCatalog
      ? await this.#modelCatalog.read()
      : { models: [], stale: true };
    const availableModels = catalog.models.filter((model) =>
      active.has(model.providerId),
    );
    const setting = this.db
      .select()
      .from(modelSettings)
      .where(eq(modelSettings.id, "default"))
      .get();
    const defaultSelection =
      setting?.providerId &&
      setting.modelId &&
      availableModels.some(
        (model) =>
          model.providerId === setting.providerId &&
          model.modelId === setting.modelId,
      )
        ? {
            providerId: setting.providerId as ModelProviderId,
            modelId: setting.modelId,
          }
        : undefined;

    return {
      providers,
      models: availableModels,
      ...(defaultSelection ? { defaultSelection } : undefined),
      ...(catalog.updatedAt
        ? { catalogUpdatedAt: catalog.updatedAt.toISOString() }
        : undefined),
      catalogStale: catalog.stale,
    };
  }

  async connectModelProvider(
    providerId: ModelProviderId,
    apiKey: string,
  ): Promise<ModelProviderDto> {
    const definition = modelProviderDefinition(providerId);
    if (providerId === "openrouter") {
      await this.#models.connect({
        credentialRef: definition.credentialRef,
        apiKey,
      });
    } else if (providerId === "openai") {
      await this.#openAiModels.connect({
        credentialRef: definition.credentialRef,
        apiKey,
      });
    } else {
      await this.#xaiModels.connect({
        credentialRef: definition.credentialRef,
        apiKey,
      });
    }
    const now = this.#now();
    this.db
      .insert(modelProviderConnections)
      .values({
        id: providerId,
        name: definition.name,
        catalogProviderId: providerId,
        credentialRef: definition.credentialRef,
        availableIn: ["local"],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: modelProviderConnections.id,
        set: { updatedAt: now },
      })
      .run();

    const provider = (await this.listModelProviders()).find(
      (item) => item.id === providerId,
    );
    if (!provider) {
      throw new Error("The AI provider was saved but could not be read");
    }
    return provider;
  }

  async disconnectModelProvider(providerId: ModelProviderId): Promise<void> {
    const definition = modelProviderDefinition(providerId);
    if (providerId === "openrouter") {
      await this.#models.disconnect(definition.credentialRef);
    } else if (providerId === "openai") {
      await this.#openAiModels.disconnect(definition.credentialRef);
    } else {
      await this.#xaiModels.disconnect(definition.credentialRef);
    }
    this.db
      .delete(modelProviderConnections)
      .where(eq(modelProviderConnections.id, providerId))
      .run();
  }

  async updateDefaultModel(
    selection: ModelSelectionDto | null,
  ): Promise<ModelSettingsDto> {
    if (selection) {
      await this.assertSelectableModel(selection);
    }
    const now = this.#now();
    this.db
      .insert(modelSettings)
      .values({
        id: "default",
        providerId: selection?.providerId ?? null,
        modelId: selection?.modelId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: modelSettings.id,
        set: {
          providerId: selection?.providerId ?? null,
          modelId: selection?.modelId ?? null,
          updatedAt: now,
        },
      })
      .run();
    return this.modelConfiguration();
  }

  async connectOpenRouter(apiKey: string): Promise<ModelProviderDto> {
    return this.connectModelProvider("openrouter", apiKey);
  }

  async disconnectOpenRouter(): Promise<void> {
    await this.disconnectModelProvider("openrouter");
  }

  async connectWebSearch(apiKey: string): Promise<ConnectionCardDto> {
    const normalized = apiKey.trim();
    if (!normalized) {
      throw new TypeError("Enter an Exa API key");
    }
    await verifyExaCredential(normalized, this.#fetch);
    await this.#credentials.put(exaCredentialRef, normalized);

    const card = (await this.listConnections()).find(
      (item) => item.id === "web-search",
    );
    if (!card) {
      throw new Error("Portable web search was saved but could not be read");
    }
    return card;
  }

  async disconnectWebSearch(): Promise<void> {
    await this.#credentials.delete(exaCredentialRef);
  }

  async proposeIntegration(
    sentence: string,
  ): Promise<IntegrationProposalOutcomeDto> {
    const template = matchConnectorTemplate(sentence);
    if (!template) {
      if (!this.#integrationResearcher) {
        return {
          status: "not_found",
          title: "I couldn't match that integration yet",
          explanation:
            "Springroll could not match a curated connector, and connector research is not configured in this build.",
        };
      }
      const researched = await this.#integrationResearcher.research(sentence);
      if (researched.status !== "ready") return researched;
      return this.researchedIntegrationProposal(researched.integration);
    }
    const actionable = template.variants.filter(
      (variant) => variant.actionable,
    );
    if (actionable.length === 0) {
      return {
        status: "unavailable",
        title: `${template.name} isn't ready to connect yet`,
        explanation: `${template.name} requires a Springroll OAuth client registration before its sign-in flow can be offered safely.`,
      };
    }
    const preferred =
      actionable.find((variant) => variant.recommended) ?? actionable[0];
    if (!preferred) throw new Error(`${template.name} has no setup variant`);
    return {
      status: "ready",
      proposal: {
        templateId: template.id,
        name: template.name,
        description: manifestDescription(preferred.manifest.blurb),
        operator: template.operator,
        trust: "curated",
        variants: actionable.map((variant) => ({
          id: variant.id,
          label: variant.label,
          recommended: variant.recommended,
          credentialKind: variant.manifest.credential.kind,
          guidance: variant.guidance,
        })),
      },
    };
  }

  async proposeLocalMcpIntegration(
    input: LocalMcpResearchInput,
  ): Promise<IntegrationProposalOutcomeDto> {
    if (!this.#localMcpResearcher) {
      return {
        status: "unavailable",
        title: "Local MCP research is unavailable",
        explanation:
          "This build cannot verify npm package metadata for a researched local connector.",
      };
    }
    const researched = await this.#localMcpResearcher.researchLocalMcp(input);
    if (researched.status !== "ready") return researched;
    return this.researchedIntegrationProposal(researched.integration);
  }

  private researchedIntegrationProposal(
    integration: ResearchedIntegration,
  ): Extract<IntegrationProposalOutcomeDto, { readonly status: "ready" }> {
    const templateId = `research-${crypto.randomUUID()}`;
    this.#researchedIntegrations.set(templateId, integration);
    const manifest = integration.manifest;
    return {
      status: "ready",
      proposal: {
        templateId,
        name: manifest.name,
        description: manifestDescription(manifest.blurb),
        operator: integration.operator,
        trust: integration.trust ?? "registry-verified",
        ...(integration.registryName
          ? { registryName: integration.registryName }
          : {}),
        ...(integration.registryVersion
          ? { registryVersion: integration.registryVersion }
          : {}),
        ...(integration.packageName
          ? { packageName: integration.packageName }
          : {}),
        ...(integration.packageVersion
          ? { packageVersion: integration.packageVersion }
          : {}),
        ...(manifest.transport.kind === "mcp-local" &&
        manifest.transport.args?.length
          ? { packageArgs: manifest.transport.args }
          : {}),
        sources: integration.sources,
        ...(manifest.tools?.allow
          ? {
              tools: manifest.tools.allow.map((name) => ({
                name,
                effect: manifest.tools?.risk?.[name]?.effect ?? "write",
              })),
            }
          : {}),
        manifest,
        variants: [
          {
            id: "researched",
            label:
              manifest.credential.kind === "oauth"
                ? `Sign in with ${manifest.name}`
                : manifest.credential.kind === "api-key"
                  ? `Connect ${manifest.name}`
                  : `Install ${manifest.name}`,
            recommended: true,
            credentialKind: manifest.credential.kind,
            guidance: integration.guidance,
          },
        ],
      },
    };
  }

  async prepareIntegrationVariant(
    templateId: string,
    variantId: string,
    durableManifest?: ConnectorManifest,
  ): Promise<ConnectionCardDto> {
    if (durableManifest) {
      if (variantId !== "researched" || !templateId.startsWith("research-")) {
        throw new TypeError(
          "Durable manifests are accepted only for researched proposals",
        );
      }
      this.#researchedIntegrations.delete(templateId);
      return this.persistPreparedManifest(durableManifest);
    }
    const researched = this.#researchedIntegrations.get(templateId);
    if (researched) {
      if (variantId !== "researched") {
        throw new TypeError("That researched setup option is not available");
      }
      this.#researchedIntegrations.delete(templateId);
      return this.persistPreparedManifest(researched.manifest);
    }
    const template = connectorTemplate(templateId);
    const variant = template?.variants.find(
      (candidate) => candidate.id === variantId,
    );
    if (!template || !variant?.actionable) {
      throw new TypeError("That integration setup option is not available");
    }
    return this.persistPreparedManifest(variant.manifest);
  }

  async prepareCustomRemoteMcp(input: {
    readonly name?: string;
    readonly endpoint: string;
    readonly credentialKind: "oauth" | "api-key" | "none";
    readonly header?: string;
  }): Promise<ConnectionCardDto> {
    const endpoint = normalizeCustomMcpEndpoint(input.endpoint);
    const url = new URL(endpoint);
    const requestedName = input.name?.trim();
    const name = manifestDescription(requestedName || url.hostname);
    if (!name) throw new TypeError("Enter a connection name");
    const id = await customManifestId(endpoint);
    const credential =
      input.credentialKind === "api-key"
        ? {
            kind: "api-key" as const,
            placeholder: `${name} API key`,
            ...(input.header?.trim() ? { header: input.header.trim() } : {}),
          }
        : input.credentialKind === "oauth"
          ? ({ kind: "oauth" } as const)
          : ({ kind: "none" } as const);
    return this.persistPreparedManifest(
      parseConnectorManifest({
        id,
        name,
        blurb: `<b>Custom MCP</b> — ${url.hostname}`,
        transport: { kind: "mcp-remote", endpoint },
        credential,
      }),
    );
  }

  private async persistPreparedManifest(
    manifestValue: ConnectorManifest,
  ): Promise<ConnectionCardDto> {
    const manifest = parseConnectorManifest(manifestValue);
    const activeConnection = this.db
      .select()
      .from(connections)
      .where(eq(connections.manifestId, manifest.id))
      .get();
    const currentManifest = this.connectorManifest(manifest.id);
    if (
      activeConnection &&
      activeConnection.config.disconnected !== true &&
      currentManifest &&
      currentManifest.credential.kind !== manifest.credential.kind
    ) {
      throw new TypeError(
        `Disconnect ${manifest.name} before changing its sign-in method`,
      );
    }
    const now = this.#now();
    this.db
      .insert(integrationManifests)
      .values({ id: manifest.id, manifest, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: integrationManifests.id,
        set: { manifest, updatedAt: now },
      })
      .run();
    const card = (await this.listConnections()).find(
      (candidate) => candidate.id === manifest.id,
    );
    if (!card)
      throw new Error(`${manifest.name} was prepared but could not be read`);
    return card;
  }

  async connectConnector(
    manifestId: string,
    input: { readonly apiKey?: string },
  ): Promise<ConnectionCardDto> {
    const manifest = this.connectorManifest(manifestId);
    if (!manifest) {
      throw new TypeError(`Unknown connector: ${manifestId}`);
    }
    if (manifest.credential.kind === "oauth") {
      throw new TypeError(
        `${manifest.name} uses OAuth. Sign-in support is not configured in this build yet.`,
      );
    }

    const apiKey = input.apiKey?.trim();
    if (manifest.credential.kind === "api-key" && !apiKey) {
      throw new TypeError(`Enter ${manifest.credential.placeholder}`);
    }

    const credentialRef =
      manifest.credential.kind === "api-key"
        ? connectorCredentialRef(manifest.id)
        : "none";
    const temporaryCredentials: CredentialStore = {
      async get(reference) {
        return reference === credentialRef ? apiKey : undefined;
      },
      async put() {},
      async delete() {},
    };
    const source =
      manifest.transport.kind === "mcp-remote"
        ? createRemoteMcpToolSource({
            manifest,
            credentials: temporaryCredentials,
            clientName: "springroll-connection-discovery",
          })
        : manifest.transport.kind === "mcp-local"
          ? createLocalMcpToolSource({
              manifest,
              credentials: temporaryCredentials,
              clientName: "springroll-connection-discovery",
            })
          : createOpenApiToolSource({
              manifest,
              credentials: temporaryCredentials,
              fetch: this.#fetch,
            });
    const card = await this.discoverAndPersistConnector(
      manifest,
      credentialRef,
      source,
      {},
      apiKey ? () => this.#credentials.put(credentialRef, apiKey) : undefined,
    );
    return card;
  }

  async startConnectorOAuth(
    manifestId: string,
    redirectUrl: string,
  ): Promise<ConnectorOAuthStartDto> {
    const manifest = this.oauthConnectorManifest(manifestId);
    const credentialRef = connectorCredentialRef(manifest.id);
    let authorizationUrl: URL | undefined;
    let provider = this.createConnectorOAuthProvider(
      manifest,
      credentialRef,
      redirectUrl,
      (url) => {
        authorizationUrl = url;
      },
    );
    let result: Awaited<ReturnType<typeof authorizeRemoteMcp>>;
    try {
      result = await authorizeRemoteMcp(provider, {
        serverUrl: manifest.transport.endpoint,
        fetchFn: this.#fetch as typeof fetch,
      });
    } catch (error) {
      if (!(error instanceof InvalidConnectorOAuthCredentialError)) throw error;
      await this.#credentials.delete(credentialRef);
      authorizationUrl = undefined;
      provider = this.createConnectorOAuthProvider(
        manifest,
        credentialRef,
        redirectUrl,
        (url) => {
          authorizationUrl = url;
        },
      );
      result = await authorizeRemoteMcp(provider, {
        serverUrl: manifest.transport.endpoint,
        fetchFn: this.#fetch as typeof fetch,
      });
    }
    if (result === "AUTHORIZED") {
      return {
        status: "connected",
        connection: await this.discoverOAuthConnector(
          manifest,
          credentialRef,
          redirectUrl,
          provider,
        ),
      };
    }
    if (!authorizationUrl) {
      throw new Error(`${manifest.name} did not provide an authorization URL`);
    }
    return {
      status: "redirect",
      authorizationUrl: authorizationUrl.toString(),
    };
  }

  async completeConnectorOAuth(
    manifestId: string,
    input: {
      readonly code: string;
      readonly state?: string;
      readonly redirectUrl: string;
    },
  ): Promise<ConnectionCardDto> {
    const manifest = this.oauthConnectorManifest(manifestId);
    const credentialRef = connectorCredentialRef(manifest.id);
    const provider = this.createConnectorOAuthProvider(
      manifest,
      credentialRef,
      input.redirectUrl,
    );
    const result = await authorizeRemoteMcp(provider, {
      serverUrl: manifest.transport.endpoint,
      authorizationCode: input.code,
      ...(input.state === undefined ? {} : { callbackState: input.state }),
      fetchFn: this.#fetch as typeof fetch,
    });
    if (result !== "AUTHORIZED") {
      throw new Error(`${manifest.name} sign-in did not complete`);
    }
    try {
      return await this.discoverOAuthConnector(
        manifest,
        credentialRef,
        input.redirectUrl,
        provider,
      );
    } catch (error) {
      await this.#credentials.delete(credentialRef);
      throw error;
    }
  }

  async disconnectConnector(manifestId: string): Promise<void> {
    const connectionId = connectorConnectionId(manifestId);
    const connection = this.db
      .select()
      .from(connections)
      .where(eq(connections.id, connectionId))
      .get();
    if (connection) {
      this.db
        .update(connections)
        .set({
          config: { ...connection.config, disconnected: true },
          updatedAt: this.#now(),
        })
        .where(eq(connections.id, connectionId))
        .run();
    }
    await this.#credentials.delete(connectorCredentialRef(manifestId));
  }

  async removeConnector(manifestId: string): Promise<void> {
    const manifest = this.connectorManifest(manifestId);
    if (!manifest) throw new TypeError(`Unknown connector: ${manifestId}`);
    const connectionId = connectorConnectionId(manifestId);
    const pinnedTasks = this.db
      .select({ taskId: taskTools.taskId })
      .from(taskTools)
      .where(eq(taskTools.connectionId, connectionId))
      .all();
    if (pinnedTasks.length > 0) {
      const count = new Set(pinnedTasks.map((row) => row.taskId)).size;
      throw new TypeError(
        `${manifest.name} is used by ${count} ${count === 1 ? "recipe" : "recipes"}. Remove it from those recipes before removing the connector.`,
      );
    }

    await this.#credentials.delete(connectorCredentialRef(manifestId));
    this.db.transaction((transaction) => {
      transaction
        .delete(connections)
        .where(eq(connections.id, connectionId))
        .run();
      transaction
        .delete(integrationManifests)
        .where(eq(integrationManifests.id, manifestId))
        .run();
    });
  }

  private oauthConnectorManifest(manifestId: string): ConnectorManifest & {
    readonly transport: {
      readonly kind: "mcp-remote";
      readonly endpoint: string;
    };
    readonly credential: { readonly kind: "oauth" };
  } {
    const manifest = this.connectorManifest(manifestId);
    if (!manifest) throw new TypeError(`Unknown connector: ${manifestId}`);
    if (
      manifest.transport.kind !== "mcp-remote" ||
      manifest.credential.kind !== "oauth"
    ) {
      throw new TypeError(`${manifest.name} does not use remote MCP OAuth`);
    }
    if (connectorTemplateMetadata.get(manifest.id)?.oauthReady === false) {
      throw new TypeError(
        `${manifest.name} sign-in needs a registered Springroll OAuth client.`,
      );
    }
    return manifest as ConnectorManifest & {
      readonly transport: {
        readonly kind: "mcp-remote";
        readonly endpoint: string;
      };
      readonly credential: { readonly kind: "oauth" };
    };
  }

  private connectorOAuthProvider(
    manifest: ConnectorManifest,
    connection: Connection,
  ): ConnectorOAuthClientProvider | undefined {
    if (manifest.credential.kind !== "oauth") return undefined;
    const redirectUrl = connection.config?.oauthRedirectUrl;
    if (typeof redirectUrl !== "string") return undefined;
    return this.createConnectorOAuthProvider(
      manifest,
      connection.credentialRef,
      redirectUrl,
    );
  }

  private createConnectorOAuthProvider(
    manifest: ConnectorManifest,
    credentialRef: string,
    redirectUrl: string,
    onRedirect?: (authorizationUrl: URL) => void | Promise<void>,
  ): ConnectorOAuthCredentialProvider {
    if (manifest.transport.kind !== "mcp-remote") {
      throw new TypeError(`${manifest.name} does not use remote MCP OAuth`);
    }
    return new ConnectorOAuthCredentialProvider({
      credentialRef,
      connectorName: manifest.name,
      serverUrl: manifest.transport.endpoint,
      redirectUrl,
      credentials: this.#credentials,
      ...(onRedirect ? { onRedirect } : {}),
    });
  }

  private async discoverOAuthConnector(
    manifest: ConnectorManifest & {
      readonly transport: {
        readonly kind: "mcp-remote";
        readonly endpoint: string;
      };
    },
    credentialRef: string,
    redirectUrl: string,
    provider: ConnectorOAuthClientProvider,
  ): Promise<ConnectionCardDto> {
    return this.discoverAndPersistConnector(
      manifest,
      credentialRef,
      createRemoteMcpToolSource({
        manifest,
        credentials: this.#credentials,
        authProvider: () => provider,
        fetch: this.#fetch as typeof fetch,
        clientName: "springroll-connection-discovery",
      }),
      { oauthRedirectUrl: redirectUrl },
    );
  }

  private async discoverAndPersistConnector(
    manifest: ConnectorManifest,
    credentialRef: string,
    source: ToolSource,
    config: Connection["config"],
    beforePersist?: () => Promise<void>,
  ): Promise<ConnectionCardDto> {
    const connectionId = connectorConnectionId(manifest.id);
    const availableIn = [...connectorAvailableIn(manifest)];
    const connection: Connection = {
      id: connectionId,
      sourceId: manifest.transport.kind,
      manifestId: manifest.id,
      credentialRef,
      availableIn,
      config: config ?? {},
    };
    const session = await source.open({ connection, location: "local" });
    let descriptors: readonly ToolDescriptor[];
    try {
      descriptors = await session.listTools();
      // MCP itself supplies a standard connection check. A plain OpenAPI spec
      // has no equivalent, so a curated API manifest may still name one safe
      // operation for credential verification.
      if (manifest.transport.kind === "openapi" && manifest.probe) {
        await session.callTool(manifest.probe.tool, manifest.probe.input, {
          taskId: "connector-verification",
          runId: `connector-verification-${manifest.id}`,
        });
      }
    } finally {
      await session.close();
    }
    await beforePersist?.();

    const persistedConfig = {
      ...(config ?? {}),
      toolCount: descriptors.length,
      toolNames: descriptors.map((descriptor) => descriptor.name),
      discoveredTools: descriptors.map((descriptor) => ({
        name: descriptor.name,
        description: descriptor.description,
        effect: descriptor.declaredRisk?.effect ?? "write",
      })),
      discovery: "passed",
      ...(manifest.transport.kind === "openapi" && manifest.probe
        ? { credentialVerification: "passed" }
        : {}),
    };
    const now = this.#now();
    this.db.transaction((transaction) => {
      transaction
        .insert(integrationManifests)
        .values({ id: manifest.id, manifest, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: integrationManifests.id,
          set: { manifest, updatedAt: now },
        })
        .run();
      transaction
        .insert(connections)
        .values({
          id: connectionId,
          name: manifest.name,
          sourceId: manifest.transport.kind,
          manifestId: manifest.id,
          credentialRef,
          config: persistedConfig,
          availableIn,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: connections.id,
          set: {
            name: manifest.name,
            sourceId: manifest.transport.kind,
            manifestId: manifest.id,
            credentialRef,
            config: persistedConfig,
            availableIn,
            updatedAt: now,
          },
        })
        .run();
    });
    const card = (await this.listConnections()).find(
      (candidate) => candidate.id === manifest.id,
    );
    if (!card)
      throw new Error(`${manifest.name} was saved but could not be read`);
    return card;
  }

  async connectNeon(input: {
    readonly url: string;
    readonly token?: string;
  }): Promise<ConnectionCardDto> {
    const url = readUrl({ url: input.url.trim() });
    const token = input.token?.trim();
    const credentialRef = token ? neonCredentialRef : "none";
    const manifest = createNeonConnectorManifest(url, Boolean(token));
    const availableIn = [...connectorAvailableIn(manifest)];
    const temporarySource = createRemoteMcpToolSource({
      manifest,
      credentials: {
        async get() {
          return token;
        },
        async put() {},
        async delete() {},
      },
      clientName: "springroll-connection-test",
    });
    const connection: Connection = {
      id: neonConnectionId,
      sourceId: manifest.transport.kind,
      manifestId: manifest.id,
      credentialRef,
      availableIn,
      config: { url },
    };
    const session = await temporarySource.open({
      connection,
      location: "local",
    });
    let descriptors: readonly ToolDescriptor[];
    try {
      descriptors = await session.listTools();
    } finally {
      await session.close();
    }

    if (token) {
      await this.#credentials.put(neonCredentialRef, token);
    } else {
      await this.#credentials.delete(neonCredentialRef);
    }

    const now = this.#now();
    this.db.transaction((transaction) => {
      transaction
        .insert(integrationManifests)
        .values({
          id: manifest.id,
          manifest,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: integrationManifests.id,
          set: { manifest, updatedAt: now },
        })
        .run();
      transaction
        .insert(connections)
        .values({
          id: neonConnectionId,
          name: "Neon",
          sourceId: manifest.transport.kind,
          manifestId: manifest.id,
          credentialRef,
          config: {
            url,
            toolCount: descriptors.length,
            discoveredTools: descriptors.map((descriptor) => ({
              name: descriptor.name,
              description: descriptor.description,
              effect: descriptor.declaredRisk?.effect ?? "write",
            })),
            discovery: "passed",
          },
          availableIn,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: connections.id,
          set: {
            name: "Neon",
            sourceId: manifest.transport.kind,
            manifestId: manifest.id,
            credentialRef,
            config: {
              url,
              toolCount: descriptors.length,
              discoveredTools: descriptors.map((descriptor) => ({
                name: descriptor.name,
                description: descriptor.description,
                effect: descriptor.declaredRisk?.effect ?? "write",
              })),
              discovery: "passed",
            },
            availableIn,
            updatedAt: now,
          },
        })
        .run();
    });

    const card = (await this.listConnections()).find(
      (item) => item.id === manifest.id,
    );
    if (!card) {
      throw new Error("The Neon connection was saved but could not be read");
    }
    return card;
  }

  async disconnectNeon(): Promise<void> {
    const neon = this.db
      .select()
      .from(connections)
      .where(eq(connections.id, neonConnectionId))
      .get();
    if (neon) {
      this.db
        .update(connections)
        .set({
          credentialRef: neonCredentialRef,
          config: {
            ...neon.config,
            disconnected: true,
          },
          updatedAt: this.#now(),
        })
        .where(eq(connections.id, neonConnectionId))
        .run();
    }
    await this.#credentials.delete(neonCredentialRef);
  }

  private connectorManifest(manifestId: string): ConnectorManifest | undefined {
    const persisted = this.db
      .select({ manifest: integrationManifests.manifest })
      .from(integrationManifests)
      .where(eq(integrationManifests.id, manifestId))
      .get();
    const registry = this.#connectorRegistry.get(manifestId);
    if (!persisted) return registry;
    return preferCurrentRegistryManifest(
      parseConnectorManifest(persisted.manifest),
      registry,
    );
  }

  private connectorManifests(): ReadonlyMap<string, ConnectorManifest> {
    const manifests = new Map(this.#connectorRegistry);
    for (const row of this.db.select().from(integrationManifests).all()) {
      const manifest = parseConnectorManifest(row.manifest);
      if (manifest.id !== row.id) {
        throw new Error(
          `Connector manifest row ${row.id} contains manifest ${manifest.id}`,
        );
      }
      manifests.set(
        manifest.id,
        preferCurrentRegistryManifest(
          manifest,
          this.#connectorRegistry.get(manifest.id),
        ),
      );
    }
    return manifests;
  }

  private async listModelProviders(): Promise<readonly ModelProviderDto[]> {
    const definitions = modelProviderDefinitions();
    const credentials = await Promise.all(
      definitions.map((definition) =>
        this.#credentials.get(definition.credentialRef),
      ),
    );
    return definitions.map((definition, index) => ({
      id: definition.id,
      name: definition.name,
      kind: definition.kind,
      status: credentials[index] ? "connected" : "not_connected",
      keyCreationUrl: definition.keyCreationUrl,
      keyPlaceholder: definition.keyPlaceholder,
    }));
  }

  private async assertSelectableModel(
    selection: ModelSelectionDto,
  ): Promise<void> {
    const configuration = await this.modelConfiguration();
    if (
      !configuration.models.some(
        (model) =>
          model.providerId === selection.providerId &&
          model.modelId === selection.modelId,
      )
    ) {
      throw new TypeError(
        "Choose a model available through a connected AI provider",
      );
    }
  }

  private async taskToolDescriptors(
    taskId: string,
  ): Promise<readonly ToolDescriptor[]> {
    const pins = this.db
      .select()
      .from(taskTools)
      .where(eq(taskTools.taskId, taskId))
      .all();
    const connectionIds = new Set(pins.map((pin) => pin.connectionId));
    const rows = this.db
      .select()
      .from(connections)
      .all()
      .filter((connection) => connectionIds.has(connection.id));
    if (rows.length !== connectionIds.size) {
      throw new Error(
        "A connection required by this task is no longer available",
      );
    }

    return (
      await Promise.all(
        rows.map(async (row): Promise<readonly ToolDescriptor[]> => {
          const source = this.#sources.get(row.sourceId);
          if (!source) {
            throw new Error(`Unknown connection source: ${row.sourceId}`);
          }
          const session = await source.open({
            connection: {
              id: row.id,
              sourceId: row.sourceId,
              ...(row.manifestId ? { manifestId: row.manifestId } : undefined),
              credentialRef: row.credentialRef,
              availableIn: row.availableIn,
              config: row.config,
            },
            location: "local",
          });
          try {
            const descriptors = new Map(
              (await session.listTools()).map((tool) => [tool.name, tool]),
            );
            return await Promise.all(
              pins
                .filter((pin) => pin.connectionId === row.id)
                .map(async (pin) => {
                  const descriptor = descriptors.get(pin.name);
                  if (!descriptor) {
                    throw new Error(
                      `Pinned tool is no longer available: ${pin.sourceId}/${pin.name}`,
                    );
                  }
                  if (
                    (await hashToolSchema(descriptor.inputSchema)) !==
                    pin.inputSchemaHash
                  ) {
                    throw new Error(
                      `Pinned tool schema changed: ${pin.sourceId}/${pin.name}`,
                    );
                  }
                  return descriptor;
                }),
            );
          } finally {
            await session.close();
          }
        }),
      )
    ).flat();
  }

  private async connectionCatalog(): Promise<readonly ConnectionCatalogItem[]> {
    const rows = this.db
      .select()
      .from(connections)
      .all()
      .filter((row) => row.config.disconnected !== true);
    const settled = await Promise.allSettled(
      rows.map(async (row): Promise<ConnectionCatalogItem> => {
        const source = this.#sources.get(row.sourceId);
        if (!source) {
          throw new Error(`Unknown connection source: ${row.sourceId}`);
        }
        const connection: Connection = {
          id: row.id,
          sourceId: row.sourceId,
          ...(row.manifestId ? { manifestId: row.manifestId } : undefined),
          credentialRef: row.credentialRef,
          availableIn: row.availableIn,
          config: row.config,
        };
        const session = await source.open({
          connection,
          location: "local",
        });
        try {
          return {
            connection,
            name: row.name ?? humanizeSource(row.sourceId),
            tools: await session.listTools(),
          };
        } finally {
          await session.close();
        }
      }),
    );

    return settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }

  private validateAndEnrichProposal(
    proposal: GeneratedTaskProposal | TaskProposalDto,
    catalog: readonly ConnectionCatalogItem[],
  ): TaskProposalDto {
    const connection = catalog.find(
      (option) => option.connection.id === proposal.connectionId,
    );
    if (!connection) {
      throw new TypeError(
        "The proposal selected a connection that is not available",
      );
    }
    const descriptors = new Map(
      connection.tools.map((tool) => [tool.name, tool]),
    );
    const selectedTools = [...new Set(proposal.toolNames)].map((name) => {
      const descriptor = descriptors.get(name);
      if (!descriptor) {
        throw new TypeError(
          `The proposal selected an unavailable tool: ${name}`,
        );
      }
      const risk = normalizedRisk(descriptor);

      return {
        name,
        description: descriptor.description,
        effect: risk.effect,
      };
    });
    if (selectedTools.length === 0) {
      throw new TypeError("The proposal must select at least one tool");
    }

    nextCronRun(proposal.schedule, proposal.timezone, this.#now());

    return {
      title: proposal.title.trim(),
      prompt: proposal.prompt.trim(),
      schedule: proposal.schedule.trim(),
      scheduleLabel: proposal.scheduleLabel.trim(),
      timezone: proposal.timezone,
      connectionId: connection.connection.id,
      connectionName: connection.name,
      toolNames: selectedTools.map((tool) => tool.name),
      tools: selectedTools,
      contract: proposal.contract.trim(),
      executionMode: "local",
      catchUpPolicy: proposal.catchUpPolicy,
    };
  }
}

function connectorConnectionId(manifestId: string): string {
  return manifestId === "neon" ? neonConnectionId : `${manifestId}-default`;
}

function connectorCredentialRef(manifestId: string): string {
  return manifestId === "neon"
    ? neonCredentialRef
    : `connector-${manifestId}-default`;
}

interface ConnectionCatalogItem {
  readonly connection: Connection;
  readonly name: string;
  readonly tools: readonly ToolDescriptor[];
}

function normalizeUnavailableProposal(
  outcome: Exclude<
    Awaited<ReturnType<TaskProposalGenerator["propose"]>>,
    { readonly status: "ready" }
  >,
): TaskProposalOutcomeDto {
  if (outcome.status === "needs_integration") {
    return {
      status: outcome.status,
      title: outcome.title.trim(),
      explanation: outcome.explanation.trim(),
      missingCapability: outcome.missingCapability.trim(),
      ...(outcome.suggestedIntegration
        ? { suggestedIntegration: outcome.suggestedIntegration.trim() }
        : undefined),
      ...(outcome.supportedAlternative
        ? { supportedAlternative: outcome.supportedAlternative.trim() }
        : undefined),
    };
  }
  return {
    status: outcome.status,
    title: outcome.title.trim(),
    explanation: outcome.explanation.trim(),
    ...(outcome.supportedAlternative
      ? { supportedAlternative: outcome.supportedAlternative.trim() }
      : undefined),
  };
}

function proposalProviderCapabilities(
  proposal: TaskProposalDto,
  catalog: readonly ConnectionCatalogItem[],
): readonly ProviderToolCapability[] {
  const connection = catalog.find(
    (item) => item.connection.id === proposal.connectionId,
  );
  if (!connection) return [];
  const selectedNames = new Set(proposal.toolNames);
  return requiredProviderToolCapabilities(
    connection.tools
      .filter((descriptor) => selectedNames.has(descriptor.name))
      .map((descriptor) => ({ descriptor })),
  );
}

function toProposalConnectionOption(
  item: ConnectionCatalogItem,
): ProposalConnectionOption {
  return {
    id: item.connection.id,
    name: item.name,
    tools: item.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  };
}

function normalizedRisk(descriptor: ToolDescriptor): {
  readonly effect: "read" | "write" | "destructive";
  readonly openWorld: boolean;
  readonly idempotent: boolean;
} {
  return {
    effect: descriptor.declaredRisk?.effect ?? "write",
    openWorld: descriptor.declaredRisk?.openWorld ?? true,
    idempotent: descriptor.declaredRisk?.idempotent ?? false,
  };
}

function toRunSummary(row: {
  readonly id: string;
  readonly taskId: string;
  readonly taskName: string | null;
  readonly prompt: string;
  readonly status: "claimed" | "running" | "succeeded" | "failed";
  readonly scheduledTime: Date;
  readonly summary: string | null;
  readonly error: string | null;
}): RunSummaryDto {
  return {
    id: row.id,
    taskId: row.taskId,
    taskName: row.taskName ?? taskName(row.prompt),
    status: row.status,
    scheduledTime: row.scheduledTime.toISOString(),
    ...(row.summary ? { summary: row.summary } : undefined),
    ...(row.error ? { error: row.error } : undefined),
    needsAttention: row.status === "failed",
  };
}

function toSafeRunEvent(row: {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: Date;
}): RunEventDto {
  const payload = objectValue(row.payload);
  const base = {
    id: row.id,
    sequence: row.sequence,
    occurredAt: row.createdAt.toISOString(),
  };

  switch (row.type) {
    case "run_started":
      return { ...base, kind: "status", title: "Run started" };
    case "model_selection": {
      const provider = stringValue(payload.provider);
      const model = stringValue(payload.modelId);
      return {
        ...base,
        kind: "model",
        title: model ? `Using ${model}` : "Model selected",
        ...(provider ? { detail: provider } : undefined),
      };
    }
    case "model_turn": {
      const phase = stringValue(payload.phase);
      const step = numberValue(payload.step);
      const provider = stringValue(payload.provider);
      const model = stringValue(payload.modelId);
      const finishReason = stringValue(payload.finishReason);
      const turnNumber = step === undefined ? undefined : step + 1;
      const detail = [provider, model].filter(Boolean).join(" · ");
      if (phase === "failed") {
        return {
          ...base,
          kind: "model",
          title: turnNumber
            ? `Model turn ${turnNumber} failed`
            : "Model turn failed",
          ...(detail ? { detail } : undefined),
          tone: "error",
        };
      }
      if (phase === "completed") {
        const outcome =
          finishReason === "tool-calls"
            ? "Requested tools"
            : finishReason === "stop"
              ? "Prepared response"
              : undefined;
        return {
          ...base,
          kind: "model",
          title: turnNumber
            ? `Model turn ${turnNumber} finished`
            : "Model turn finished",
          ...(detail || outcome
            ? { detail: [detail, outcome].filter(Boolean).join(" · ") }
            : undefined),
          tone: "success",
        };
      }
      return {
        ...base,
        kind: "model",
        title: turnNumber
          ? `Starting model turn ${turnNumber}`
          : "Starting model turn",
        ...(detail ? { detail } : undefined),
      };
    }
    case "model_retry": {
      const attempt = numberValue(payload.attempt);
      const provider = stringValue(payload.provider);
      const model = stringValue(payload.modelId);
      return {
        ...base,
        kind: "model",
        title: "Retrying model call",
        detail: [
          attempt === undefined ? undefined : `Attempt ${attempt}`,
          provider,
          model,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "lifecycle": {
      const phase = stringValue(payload.phase);
      const message = boundedText(payload.message);
      if (phase === "failed" || phase === "cancelled") {
        return {
          ...base,
          kind: "status",
          title: phase === "cancelled" ? "Agent stopped" : "Agent failed",
          ...(message ? { detail: message } : undefined),
          tone: "error",
        };
      }
      return {
        ...base,
        kind: "status",
        title: phase === "completed" ? "Agent finished" : "Agent started",
        ...(phase === "completed" ? { tone: "success" as const } : undefined),
      };
    }
    case "policy_decision": {
      const decision = stringValue(payload.decision);
      const toolName = stringValue(payload.toolName);
      const reason = boundedText(payload.reason);
      return {
        ...base,
        kind: "policy",
        title:
          decision === "allowed"
            ? `${toolName ? humanizeIdentifier(toolName) : "Tool"} allowed`
            : decision === "approval_required"
              ? "Approval required"
              : "Tool access denied",
        ...(reason ? { detail: reason } : undefined),
        ...(decision === "denied" ? { tone: "error" as const } : undefined),
      };
    }
    case "tool_call": {
      const toolName = stringValue(payload.toolName);
      const sourceId = stringValue(payload.sourceId);
      return {
        ...base,
        kind: "tool",
        title: toolName
          ? `Using ${humanizeIdentifier(toolName)}`
          : "Calling a tool",
        ...(sourceId ? { detail: sourceId } : undefined),
      };
    }
    case "tool_result": {
      const failed = payload.status === "failed";
      const detail = boundedText(
        failed ? payload.error : payload.outputSummary,
      );
      return {
        ...base,
        kind: "tool",
        title: failed ? "Tool call failed" : "Tool call finished",
        ...(detail ? { detail } : undefined),
        tone: failed ? "error" : "success",
      };
    }
    case "source": {
      const title = boundedText(payload.title, 120) ?? "Source found";
      const url = safePublicUrl(payload.url);
      return {
        ...base,
        kind: "source",
        title,
        ...(url ? { sourceUrl: url } : undefined),
      };
    }
    case "usage": {
      const totalTokens = numberValue(payload.totalTokens);
      const webSearchRequests = numberValue(payload.webSearchRequests);
      const providerToolCalls = numberValue(payload.providerToolCalls);
      const provider = stringValue(payload.provider);
      const model = stringValue(payload.modelId);
      return {
        ...base,
        kind: "usage",
        title:
          totalTokens !== undefined
            ? `${totalTokens.toLocaleString()} tokens used`
            : webSearchRequests !== undefined
              ? `${webSearchRequests.toLocaleString()} web search ${webSearchRequests === 1 ? "request" : "requests"}`
              : providerToolCalls !== undefined
                ? `${providerToolCalls.toLocaleString()} provider tool ${providerToolCalls === 1 ? "call" : "calls"}`
                : "Model call finished",
        ...(provider || model
          ? { detail: [provider, model].filter(Boolean).join(" · ") }
          : undefined),
      };
    }
    case "message":
      return { ...base, kind: "output", title: "Prepared the response" };
    case "agent_output":
    case "stub_output":
      return { ...base, kind: "output", title: "Saved the result" };
    case "run_succeeded":
      return {
        ...base,
        kind: "status",
        title: "Run completed",
        tone: "success",
      };
    case "run_failed": {
      const error = boundedText(payload.error);
      return {
        ...base,
        kind: "status",
        title: "Run failed",
        ...(error ? { detail: error } : undefined),
        tone: "error",
      };
    }
    default:
      return { ...base, kind: "status", title: "Run updated" };
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function boundedText(value: unknown, limit = 240): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function safePublicUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function taskName(prompt: string): string {
  const firstSentence =
    prompt.split(/[.!?\n]/, 1)[0]?.trim() || "Untitled task";
  return firstSentence.length > 64
    ? `${firstSentence.slice(0, 61).trimEnd()}...`
    : firstSentence;
}

function humanizeSource(sourceId: string): string {
  return sourceId
    .replace(/^(native|mcp)\./, "")
    .split(/[.-]/)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function manifestDescription(blurb: string): string {
  return blurb.replace(/<[^>]*>/g, "").trim();
}

function preferCurrentRegistryManifest(
  persisted: ConnectorManifest,
  registry: ConnectorManifest | undefined,
): ConnectorManifest {
  // Persisted rows remember a selected credential variant. When that rail is
  // unchanged, use the shipped definition so stale authored probes and tool
  // lists do not survive an app update. A deliberately selected alternate
  // rail (for example Neon's one-key fallback) remains intact.
  return registry && registry.credential.kind === persisted.credential.kind
    ? registry
    : persisted;
}

function normalizeCustomMcpEndpoint(value: string): string {
  const url = new URL(value.trim());
  const localHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new TypeError(
      "Custom MCP endpoints must use HTTPS, except for localhost development",
    );
  }
  url.hash = "";
  return url.toString();
}

async function customManifestId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint),
  );
  const suffix = Array.from(new Uint8Array(digest).slice(0, 6), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const host = new URL(endpoint).hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  return `custom-${host || "mcp"}-${suffix}`;
}

function readDiscoveredTools(value: unknown):
  | readonly {
      readonly name: string;
      readonly description?: string;
      readonly effect: "read" | "write" | "destructive";
    }[]
  | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const name = Reflect.get(item, "name");
    const effect = Reflect.get(item, "effect");
    const description = Reflect.get(item, "description");
    if (
      typeof name !== "string" ||
      (effect !== "read" && effect !== "write" && effect !== "destructive")
    ) {
      return [];
    }
    return [
      {
        name,
        ...(typeof description === "string" ? { description } : undefined),
        effect,
      },
    ];
  });
}

interface ModelProviderDefinition {
  readonly id: ModelProviderId;
  readonly name: string;
  readonly kind: ModelProviderDto["kind"];
  readonly credentialRef: string;
  readonly keyCreationUrl: string;
  readonly keyPlaceholder: string;
}

function modelProviderDefinitions(): readonly ModelProviderDefinition[] {
  return [
    {
      id: "openrouter",
      name: "OpenRouter",
      kind: "aggregator",
      credentialRef: openRouterCredentialRef,
      keyCreationUrl: "https://openrouter.ai/settings/keys",
      keyPlaceholder: "sk-or-v1-…",
    },
    {
      id: "openai",
      name: "OpenAI",
      kind: "direct_api",
      credentialRef: openAiCredentialRef,
      keyCreationUrl: "https://platform.openai.com/api-keys",
      keyPlaceholder: "sk-…",
    },
    {
      id: "xai",
      name: "xAI",
      kind: "direct_api",
      credentialRef: xaiCredentialRef,
      keyCreationUrl: "https://console.x.ai/",
      keyPlaceholder: "xai-…",
    },
  ];
}

function modelProviderDefinition(
  providerId: ModelProviderId,
): ModelProviderDefinition {
  const definition = modelProviderDefinitions().find(
    (provider) => provider.id === providerId,
  );
  if (!definition) {
    throw new TypeError(`Unsupported AI provider: ${providerId}`);
  }
  return definition;
}
