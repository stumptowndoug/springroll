import {
  AgentRunExecutor,
  type AgentRunner,
  type AppDatabase,
  type Connection,
  type CredentialStore,
  connections,
  createHackerNewsToolSource,
  createRemoteMcpToolSource,
  type FetchApi,
  hashToolSchema,
  modelProviderConnections,
  modelSettings,
  nextCronRun,
  OpenAiModelConnection,
  type OpenRouterModelConnection,
  type ProviderToolCapability,
  requiredProviderToolCapabilities,
  runEvents,
  runs,
  type ToolDescriptor,
  type ToolSource,
  tasks,
  taskTools,
  verifyExaCredential,
  XaiModelConnection,
} from "@shrimp-roll/kernel";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type {
  AppSnapshotDto,
  CatchUpPolicy,
  ConnectionCardDto,
  ModelExecutionDto,
  ModelProviderDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelSettingsDto,
  RunDetailDto,
  RunEventDto,
  RunEventPageDto,
  RunStartDto,
  RunSummaryDto,
  TaskProposalDto,
  TaskProposalOutcomeDto,
  TaskSummaryDto,
} from "../shared.ts";
import type { ModelsDevCatalog } from "./model-catalog.ts";
import type {
  GeneratedTaskProposal,
  ProposalConnectionOption,
  TaskProposalGenerator,
} from "./proposal-generator.ts";
import {
  createNeonToolSource,
  createWebToolSource,
  exaCredentialRef,
  hackerNewsConnectionId,
  hackerNewsSourceId,
  neonConnectionId,
  neonCredentialRef,
  neonSourceId,
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
  readonly modelCatalog?: Pick<ModelsDevCatalog, "read">;
  readonly agent: AgentRunner;
  readonly resolveModelExecution?: ResolveModelExecution;
  readonly proposalGenerator: TaskProposalGenerator;
  readonly now?: () => Date;
  readonly extraToolSources?: readonly ToolSource[];
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
  readonly catchUpPolicy?: CatchUpPolicy;
  readonly modelSelection?: ModelSelectionDto | null;
}

const builtinConnectionName = "Hacker News";

export class LocalApplication {
  readonly #credentials: CredentialStore;
  readonly #models: OpenRouterModelConnection;
  readonly #openAiModels: OpenAiModelConnection;
  readonly #xaiModels: XaiModelConnection;
  readonly #modelCatalog: Pick<ModelsDevCatalog, "read"> | undefined;
  readonly #proposalGenerator: TaskProposalGenerator;
  readonly #resolveModelExecution: ResolveModelExecution | undefined;
  readonly #now: () => Date;
  readonly #fetch: FetchApi;
  readonly #sources: Map<string, ToolSource>;
  readonly #executor: AgentRunExecutor;
  readonly #manualRuns = new Map<string, Promise<RunStartDto>>();

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
    this.#resolveModelExecution = options.resolveModelExecution;
    this.#now = options.now ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#sources = new Map(
      [
        createHackerNewsToolSource(),
        createWebToolSource(options.credentials, options.fetch),
        createNeonToolSource(options.credentials),
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

  ensureBuiltinConnections(): void {
    this.db.transaction((transaction) => {
      transaction
        .insert(connections)
        .values([
          {
            id: hackerNewsConnectionId,
            name: builtinConnectionName,
            sourceId: hackerNewsSourceId,
            credentialRef: "none",
            config: {},
            availableIn: ["local"],
          },
          {
            id: webConnectionId,
            name: "Web",
            sourceId: webSourceId,
            credentialRef: exaCredentialRef,
            config: {},
            availableIn: ["local"],
          },
        ])
        .onConflictDoNothing({
          target: connections.id,
        })
        .run();
    });
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

    return taskRows.map((task) => ({
      id: task.id,
      name: task.name ?? taskName(task.prompt),
      prompt: task.prompt,
      schedule: task.schedule,
      timezone: task.scheduleTimezone,
      enabled: task.enabled,
      catchUpPolicy: task.catchUpPolicy,
      nextRunAt: task.nextRunAt.toISOString(),
      connectionNames: [...(namesByTask.get(task.id) ?? [])],
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
  ): Promise<TaskSummaryDto> {
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
    const id = crypto.randomUUID();
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
    const neon = this.db
      .select()
      .from(connections)
      .where(eq(connections.id, neonConnectionId))
      .get();
    const neonUrl =
      neon && typeof neon.config.url === "string" ? neon.config.url : undefined;
    const neonToolCount =
      neon && typeof neon.config.toolCount === "number"
        ? neon.config.toolCount
        : undefined;
    const neonConnected = Boolean(neon && neon.config.disconnected !== true);
    const portableWebConnected = Boolean(
      await this.#credentials.get(exaCredentialRef),
    );

    return [
      {
        id: "web-search",
        name: "Exa",
        description:
          "Built-in public web search and page reading for every model.",
        status: "connected",
        credentialConfigured: portableWebConnected,
        keyCreationUrl: "https://dashboard.exa.ai/api-keys",
      },
      {
        id: "google-search",
        name: "Google",
        description:
          "Gemini-native Google Search grounding when Google models arrive.",
        status: "coming_soon",
      },
      {
        id: "tavily",
        name: "Tavily",
        description: "Agent-oriented search and page extraction.",
        status: "coming_soon",
      },
      {
        id: "parallel",
        name: "Parallel",
        description: "Fast agent search with structured web context.",
        status: "coming_soon",
      },
      {
        id: "firecrawl",
        name: "Firecrawl",
        description: "Search, scrape, and read sites that require rendering.",
        status: "coming_soon",
      },
      {
        id: "neon",
        name: "Neon",
        description: "A remote MCP connection for database-aware tasks.",
        status: neonConnected ? "connected" : "not_connected",
        ...(neonUrl ? { endpoint: neonUrl } : undefined),
        ...(neonToolCount === undefined
          ? undefined
          : { toolCount: neonToolCount }),
      },
      {
        id: "gmail",
        name: "Gmail",
        description: "Read-only inbox triage arrives in the next phase.",
        status: "coming_soon",
      },
      {
        id: "custom-api",
        name: "Custom API",
        description:
          "Bring an OpenAPI endpoint or a small ShrimpRoll integration template.",
        status: "coming_soon",
      },
    ];
  }

  async modelConfiguration(): Promise<ModelSettingsDto> {
    const providers = await this.listModelProviders();
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

  async connectNeon(input: {
    readonly url: string;
    readonly token?: string;
  }): Promise<ConnectionCardDto> {
    const url = readUrl({ url: input.url.trim() });
    const token = input.token?.trim();
    const credentialRef = token ? neonCredentialRef : "none";
    const temporarySource = createRemoteMcpToolSource({
      id: neonSourceId,
      url,
      clientName: "shrimproll-connection-test",
      ...(token
        ? {
            headers: () => ({
              authorization: `Bearer ${token}`,
            }),
          }
        : undefined),
    });
    const connection: Connection = {
      id: neonConnectionId,
      sourceId: neonSourceId,
      credentialRef,
      availableIn: ["local"],
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
    this.db
      .insert(connections)
      .values({
        id: neonConnectionId,
        name: "Neon",
        sourceId: neonSourceId,
        credentialRef,
        config: {
          url,
          toolCount: descriptors.length,
        },
        availableIn: ["local"],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: connections.id,
        set: {
          name: "Neon",
          credentialRef,
          config: {
            url,
            toolCount: descriptors.length,
          },
          updatedAt: now,
        },
      })
      .run();

    const card = (await this.listConnections()).find(
      (item) => item.id === "neon",
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
      const provider = stringValue(payload.provider);
      const model = stringValue(payload.modelId);
      return {
        ...base,
        kind: "usage",
        title:
          totalTokens === undefined
            ? "Model call finished"
            : `${totalTokens.toLocaleString()} tokens used`,
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
