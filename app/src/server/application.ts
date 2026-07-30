import {
  AgentRunExecutor,
  type AgentRunner,
  type AppDatabase,
  type Connection,
  type CredentialStore,
  connections,
  createHackerNewsToolSource,
  createRemoteMcpToolSource,
  hashToolSchema,
  nextCronRun,
  type OpenRouterModelConnection,
  runEvents,
  runs,
  type ToolDescriptor,
  type ToolSource,
  tasks,
  taskTools,
} from "@shrimp-roll/kernel";
import { and, desc, eq } from "drizzle-orm";
import type {
  AppSnapshotDto,
  CatchUpPolicy,
  ConnectionCardDto,
  RunDetailDto,
  RunSummaryDto,
  TaskProposalDto,
  TaskSummaryDto,
} from "../shared.ts";
import type {
  GeneratedTaskProposal,
  ProposalConnectionOption,
  TaskProposalGenerator,
} from "./proposal-generator.ts";
import {
  createNeonToolSource,
  hackerNewsConnectionId,
  hackerNewsSourceId,
  neonConnectionId,
  neonCredentialRef,
  neonSourceId,
  openRouterCredentialRef,
  readUrl,
} from "./sources.ts";

export interface LocalApplicationOptions {
  readonly credentials: CredentialStore;
  readonly models: OpenRouterModelConnection;
  readonly agent: AgentRunner;
  readonly proposalGenerator: TaskProposalGenerator;
  readonly now?: () => Date;
  readonly extraToolSources?: readonly ToolSource[];
}

export interface UpdateTaskInput {
  readonly enabled?: boolean;
  readonly catchUpPolicy?: CatchUpPolicy;
}

const builtinConnectionName = "Hacker News";

export class LocalApplication {
  readonly #credentials: CredentialStore;
  readonly #models: OpenRouterModelConnection;
  readonly #proposalGenerator: TaskProposalGenerator;
  readonly #now: () => Date;
  readonly #sources: Map<string, ToolSource>;
  readonly #executor: AgentRunExecutor;

  constructor(
    private readonly db: AppDatabase,
    options: LocalApplicationOptions,
  ) {
    this.#credentials = options.credentials;
    this.#models = options.models;
    this.#proposalGenerator = options.proposalGenerator;
    this.#now = options.now ?? (() => new Date());
    this.#sources = new Map(
      [
        createHackerNewsToolSource(),
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
    this.db
      .insert(connections)
      .values({
        id: hackerNewsConnectionId,
        name: builtinConnectionName,
        sourceId: hackerNewsSourceId,
        credentialRef: "none",
        config: {},
        availableIn: ["local"],
      })
      .onConflictDoNothing({
        target: connections.id,
      })
      .run();
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
        error: runs.error,
        executionLocation: runs.executionLocation,
        startedAt: runs.startedAt,
        finishedAt: runs.finishedAt,
        durationMs: runs.durationMs,
        costUsdMicros: runs.costUsdMicros,
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

    return {
      ...toRunSummary(row),
      ...(row.body ? { body: row.body } : undefined),
      executionLocation: row.executionLocation,
      ...(row.startedAt
        ? { startedAt: row.startedAt.toISOString() }
        : undefined),
      ...(row.finishedAt
        ? { finishedAt: row.finishedAt.toISOString() }
        : undefined),
      ...(row.durationMs === null ? undefined : { durationMs: row.durationMs }),
      ...(row.costUsdMicros === null
        ? undefined
        : { costUsdMicros: row.costUsdMicros }),
      toolCalls: toolCallRows.length,
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
    }));
  }

  async getTask(taskId: string): Promise<TaskSummaryDto | undefined> {
    return (await this.listTasks()).find((task) => task.id === taskId);
  }

  async proposeTask(
    sentence: string,
    timezone: string,
  ): Promise<TaskProposalDto> {
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

    return this.validateAndEnrichProposal(generated, catalog);
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
      updatedAt: this.#now(),
    };
    const changed = this.db
      .update(tasks)
      .set(update)
      .where(eq(tasks.id, taskId))
      .returning({ id: tasks.id })
      .get();

    return changed ? this.getTask(taskId) : undefined;
  }

  async runTaskNow(taskId: string): Promise<RunDetailDto> {
    const task = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    if (!task) {
      throw new TypeError("The task no longer exists");
    }

    const scheduledTime = this.#now();
    const runId = crypto.randomUUID();
    this.db
      .insert(runs)
      .values({
        id: runId,
        taskId,
        scheduledTime,
        status: "claimed",
        executionLocation: "local",
      })
      .run();
    await this.#executor.execute(runId, taskId, scheduledTime);

    const result = await this.getRun(runId);
    if (!result) {
      throw new Error("The run completed but could not be read");
    }

    return result;
  }

  async listConnections(): Promise<readonly ConnectionCardDto[]> {
    const [openRouterKey, neon] = await Promise.all([
      this.#credentials.get(openRouterCredentialRef),
      Promise.resolve(
        this.db
          .select()
          .from(connections)
          .where(eq(connections.id, neonConnectionId))
          .get(),
      ),
    ]);
    const neonUrl =
      neon && typeof neon.config.url === "string" ? neon.config.url : undefined;
    const neonToolCount =
      neon && typeof neon.config.toolCount === "number"
        ? neon.config.toolCount
        : undefined;
    const neonConnected = Boolean(neon && neon.config.disconnected !== true);

    return [
      {
        id: "openrouter",
        name: "OpenRouter",
        description: "The AI connection used to understand and run tasks.",
        status: openRouterKey ? "connected" : "not_connected",
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
    ];
  }

  async connectOpenRouter(apiKey: string): Promise<ConnectionCardDto> {
    await this.#models.connect({
      credentialRef: openRouterCredentialRef,
      apiKey,
    });

    return (await this.listConnections())[0] as ConnectionCardDto;
  }

  async disconnectOpenRouter(): Promise<void> {
    await this.#models.disconnect(openRouterCredentialRef);
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
