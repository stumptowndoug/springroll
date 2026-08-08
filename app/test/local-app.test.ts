import { afterEach, describe, expect, test } from "bun:test";
import {
  type AgentRunner,
  AiSdkAssistant,
  type ConnectorManifest,
  type CredentialStore,
  connections as connectionTable,
  createHackerNewsToolSource,
  createMarkdownRunResult,
  createNativeToolSource,
  credentialAuditEvents,
  type FetchApi,
  inspectRecipeHistoryToolName,
  integrationManifests,
  type LocalTaskRunHost,
  modelCalls,
  OpenRouterModelConnection,
  openLocalDatabase,
  SqliteChatStore,
  SqliteRecipeKnowledgeStore,
  type ToolDescriptor,
  type ToolSource,
  taskTools as taskToolTable,
  toolApprovals as toolApprovalTable,
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
} from "@springroll/kernel";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  LocalApplication,
  type ResolveModelExecution,
} from "../src/server/application.ts";
import { createSpringrollApplicationTools } from "../src/server/assistant-tools.ts";
import { type AssistantApi, createHttpApp } from "../src/server/http-app.ts";
import type {
  IntegrationResearcher,
  LocalMcpIntegrationResearcher,
} from "../src/server/integration-researcher.ts";
import { VerifiedOpenApiResearcher } from "../src/server/integration-researcher.ts";
import { chooseModelExecution } from "../src/server/model-selection.ts";
import type { TaskProposalGenerator } from "../src/server/proposal-generator.ts";
import {
  exaCredentialRef,
  openRouterCredentialRef,
  webConnectionId,
} from "../src/server/sources.ts";
import type {
  ConnectionCardDto,
  TaskProposalDto,
  TaskProposalOutcomeDto,
} from "../src/shared.ts";

const hackerNewsConnectionId = "fixture-hacker-news";
const hackerNewsSourceId = "native.hacker-news";

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();

  async get(reference: string): Promise<string | undefined> {
    return this.values.get(reference);
  }

  async put(reference: string, secret: string): Promise<void> {
    this.values.set(reference, secret);
  }

  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

const now = new Date("2026-07-30T12:00:00.000Z");
const proposalGenerator: TaskProposalGenerator = {
  async propose(input) {
    return {
      status: "ready",
      proposal: {
        title: "Morning HN digest",
        prompt: input.sentence,
        schedule: "0 8 * * *",
        scheduleLabel: "Daily at 8:00 AM",
        timezone: input.timezone,
        connectionId: hackerNewsConnectionId,
        toolNames: ["get_hacker_news_top_stories"],
        contract:
          "Every morning I will read public Hacker News stories and summarize them. I cannot post or change anything.",
        catchUpPolicy: "skip_to_next",
      },
    };
  },
};
const agent: AgentRunner = {
  async run(request) {
    expect(
      request.tools
        .map((tool) => tool.descriptor.name)
        .filter((name) => name !== inspectRecipeHistoryToolName),
    ).toEqual(["get_hacker_news_top_stories"]);
    return {
      result: createMarkdownRunResult({
        body: "I read the top Hacker News stories. AI and local-first software led the discussion.",
        fallbackSummary: "AI and local-first software led Hacker News.",
        summary: "AI and local-first software led Hacker News.",
      }),
      toolCalls: [],
      usage: {
        provider: "openrouter",
        modelId: "test-model",
        billing: "metered",
        inputTokens: 30,
        outputTokens: 12,
        cachedInputTokens: 5,
        reasoningTokens: 3,
        totalTokens: 42,
        costUsdMicros: 120,
        actualCostUsdMicros: 120,
        estimatedCostUsdMicros: 110,
        costSource: "provider_reported",
        webSearchRequests: 1,
      },
      startedAt: now,
      finishedAt: new Date(now.getTime() + 1_000),
    };
  },
};

const resolveModelExecution: ResolveModelExecution = async (
  taskSelection,
  requiredCapabilities,
) =>
  chooseModelExecution({
    taskSelection,
    automaticSelections: [{ providerId: "openrouter", modelId: "test/model" }],
    connectedProviders: new Set(["openrouter"]),
    requiredCapabilities,
    portableCapabilities: new Set([
      webSearchProviderToolCapability,
      webFetchProviderToolCapability,
    ]),
  });

const databases: ReturnType<typeof openLocalDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function createHarness(
  selectedProposalGenerator: TaskProposalGenerator = proposalGenerator,
  selectedResolver: ResolveModelExecution = resolveModelExecution,
  selectedAgent: AgentRunner = agent,
  selectedNow: () => Date = () => now,
  selectedFetch: FetchApi = async () => Response.json({ results: [] }),
  integrationResearcher?: IntegrationResearcher,
  extraToolSources?: readonly ToolSource[],
  localMcpResearcher?: LocalMcpIntegrationResearcher,
  seedHackerNewsFixture = true,
) {
  const database = openLocalDatabase({ filename: ":memory:" });
  databases.push(database);
  const credentials = new MemoryCredentialStore();
  const models = new OpenRouterModelConnection(credentials, {
    fetch: async () => Response.json({ data: { label: "test-key" } }),
  });
  const application = new LocalApplication(database.db, {
    credentials,
    models,
    modelCatalog: {
      async read() {
        return {
          models: [
            {
              providerId: "openrouter",
              modelId: "test/model",
              name: "Test Model",
              contextTokens: 128_000,
              inputUsdPerMillionTokens: 1,
              outputUsdPerMillionTokens: 3,
              reasoning: true,
              toolCall: true,
              inputModalities: ["text"],
            },
          ],
          updatedAt: now,
          stale: false,
        };
      },
    },
    agent: selectedAgent,
    resolveModelExecution: selectedResolver,
    proposalGenerator: selectedProposalGenerator,
    ...(integrationResearcher ? { integrationResearcher } : {}),
    ...(localMcpResearcher ? { localMcpResearcher } : {}),
    openApiResearcher: new VerifiedOpenApiResearcher({ fetch: selectedFetch }),
    extraToolSources: [
      ...(seedHackerNewsFixture
        ? [createHackerNewsToolSource({ fetch: selectedFetch })]
        : []),
      ...(extraToolSources ?? []),
    ],
    now: selectedNow,
    fetch: selectedFetch,
  });
  application.ensureBuiltinConnections();
  if (seedHackerNewsFixture) {
    database.db
      .insert(connectionTable)
      .values({
        id: hackerNewsConnectionId,
        name: "Hacker News",
        sourceId: hackerNewsSourceId,
        credentialRef: "none",
        config: {},
        availableIn: ["local"],
      })
      .run();
  }

  return { application, credentials, database };
}

function readyProposal(outcome: TaskProposalOutcomeDto): TaskProposalDto {
  expect(outcome.status).toBe("ready");
  if (outcome.status !== "ready") {
    throw new Error("Expected a ready task proposal");
  }
  return outcome.proposal;
}

async function waitForFinishedRun(
  application: LocalApplication,
  runId: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await application.getRun(runId);
    if (run?.status === "succeeded" || run?.status === "failed") {
      return run;
    }
    await Bun.sleep(1);
  }
  throw new Error(`Run ${runId} did not finish`);
}

describe("local product application", () => {
  test("proposes, saves, runs, and reads a task through the shared kernel", async () => {
    const progressAgent: AgentRunner = {
      async run(request) {
        await request.eventSink?.append(
          {
            type: "model_turn",
            turnId: "call-1:0",
            step: 0,
            phase: "started",
            provider: "openrouter",
            modelId: "test/model",
          },
          now,
        );
        await request.eventSink?.append(
          {
            type: "model_retry",
            turnId: "call-1:0",
            step: 0,
            attempt: 2,
            provider: "openrouter",
            modelId: "test/model",
          },
          now,
        );
        await request.eventSink?.append(
          {
            type: "model_turn",
            turnId: "call-1:0",
            step: 0,
            phase: "completed",
            provider: "openrouter",
            modelId: "test/model",
            finishReason: "stop",
            durationMs: 500,
          },
          now,
        );
        return agent.run(request);
      },
    };
    const { application } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      progressAgent,
    );

    const proposal = readyProposal(
      await application.proposeTask(
        "Summarize Hacker News every morning",
        "UTC",
      ),
    );
    expect(proposal).toMatchObject({
      title: "Morning HN digest",
      connectionName: "Hacker News",
      executionMode: "local",
      tools: [
        {
          name: "get_hacker_news_top_stories",
          effect: "read",
          approval: "never",
        },
      ],
    });

    const task = await application.createTask(proposal, false);
    expect(task).toMatchObject({
      name: "Morning HN digest",
      enabled: false,
      connectionNames: ["Hacker News"],
    });
    const started = await application.runTaskNow(task.id);
    const run = await waitForFinishedRun(application, started.id);
    expect(run).toMatchObject({
      taskName: "Morning HN digest",
      status: "succeeded",
      summary: "AI and local-first software led Hacker News.",
      durationMs: 1_000,
      costUsdMicros: 120,
      actualCostUsdMicros: 120,
      estimatedCostUsdMicros: 110,
      costSource: "provider_reported",
      inputTokens: 30,
      outputTokens: 12,
      cachedInputTokens: 5,
      reasoningTokens: 3,
      totalTokens: 42,
      webSearchRequests: 1,
      toolCalls: 1,
    });
    expect((await application.snapshot()).runs).toHaveLength(1);
    expect(await application.listRunEvents(started.id)).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({
          kind: "model",
          title: "Starting model turn 1",
        }),
        expect.objectContaining({
          kind: "model",
          title: "Retrying model call",
          detail: "Attempt 2 · openrouter · test/model",
        }),
        expect.objectContaining({
          kind: "model",
          title: "Model turn 1 finished",
          tone: "success",
        }),
      ]),
    });

    const enabled = await application.updateTask(task.id, { enabled: true });
    expect(enabled?.enabled).toBe(true);
  });

  test("routes local task lifecycle and manual runs through the attached host", async () => {
    const { application } = createHarness();
    const calls: string[] = [];
    const host: LocalTaskRunHost = {
      async syncTask(taskId) {
        calls.push(`sync:${taskId}`);
      },
      async removeTask(taskId) {
        calls.push(`remove:${taskId}`);
      },
      async enqueueRun(runId, taskId, scheduledTime) {
        calls.push(`enqueue:${runId}:${taskId}:${scheduledTime.toISOString()}`);
      },
      async shutdown() {},
    };
    application.attachTaskRunHost(host);
    const proposal = readyProposal(
      await application.proposeTask("Summarize Hacker News", "UTC"),
    );

    const lifecycleTask = await application.createTask(proposal, false, {
      id: "actor-lifecycle",
    });
    await application.updateTask(lifecycleTask.id, { name: "Updated digest" });
    expect(await application.deleteTask(lifecycleTask.id)).toBe("deleted");

    const manualTask = await application.createTask(proposal, false, {
      id: "actor-manual",
    });
    const started = await application.runTaskNow(
      manualTask.id,
      "manual-request",
    );

    expect(calls).toEqual([
      "sync:actor-lifecycle",
      "sync:actor-lifecycle",
      "remove:actor-lifecycle",
      "sync:actor-manual",
      `enqueue:${started.id}:actor-manual:${now.toISOString()}`,
    ]);
    expect((await application.getRun(started.id))?.status).toBe("claimed");
  });

  test("shows and approves recipe knowledge through the product API", async () => {
    const { application, database } = createHarness();
    const proposal = readyProposal(
      await application.proposeTask(
        "Summarize Hacker News every morning",
        "UTC",
      ),
    );
    const task = await application.createTask(proposal, false);
    new SqliteRecipeKnowledgeStore(database.db).createRevision({
      taskId: task.id,
      knowledge: {
        schemaVersion: 1,
        markdown: "# Hacker News\n\nRead the reviewed top-stories feed.",
      },
    });
    const http = createHttpApp(application);
    const response = await http.request(`/api/tasks/${task.id}/knowledge`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      taskId: task.id,
      revision: 1,
      status: "needs_review",
      knowledge: {
        markdown: "# Hacker News\n\nRead the reviewed top-stories feed.",
      },
    });

    const approved = await http.request(
      `/api/tasks/${task.id}/knowledge/1/approve`,
      { method: "POST" },
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      revision: 1,
      status: "ready",
      approvedAt: now.toISOString(),
    });
  });

  test("serves the product API and stores OpenRouter keys outside SQLite", async () => {
    const { application, credentials, database } = createHarness();
    expect(
      database.db
        .select()
        .from(connectionTable)
        .all()
        .some((connection) => connection.id === "builtin-hacker-news"),
    ).toBe(false);
    const http = createHttpApp(application);

    const connected = await http.request("/api/connections/openrouter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-or-v1-test" }),
    });
    expect(connected.status).toBe(200);
    expect(await connected.json()).toMatchObject({
      id: "openrouter",
      status: "connected",
    });
    expect(credentials.values.get(openRouterCredentialRef)).toBe(
      "sk-or-v1-test",
    );
    const webSearch = await http.request("/api/connections/web-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "exa-test" }),
    });
    expect(webSearch.status).toBe(200);
    expect(await webSearch.json()).toMatchObject({
      id: "web-search",
      status: "connected",
      credentialConfigured: true,
    });
    expect(credentials.values.get(exaCredentialRef)).toBe("exa-test");
    expect(await (await http.request("/api/connections")).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "web-search",
          name: "Exa",
          status: "connected",
          credentialConfigured: true,
        }),
        expect.objectContaining({
          id: "google-search",
          status: "coming_soon",
        }),
        expect.objectContaining({
          id: "neon",
          featured: true,
          actionable: true,
          setupVariantId: "oauth",
        }),
        expect.objectContaining({
          id: "jira",
          featured: true,
          actionable: true,
          credentialKind: "oauth",
          setupVariantId: "oauth",
        }),
        expect.objectContaining({
          id: "gmail",
          featured: false,
          actionable: false,
        }),
      ]),
    );
    const webSearchDetail = await http.request("/api/connections/web-search");
    expect(webSearchDetail.status).toBe(200);
    expect(await webSearchDetail.json()).toMatchObject({
      id: "web-search",
      catalogSource: "live",
      agentAccess: {
        mode: "on-demand",
        catalogIncludes: "names-and-effects",
        detailIncludes: "descriptions-and-schemas",
        directEffects: ["read", "write"],
        approvalEffects: ["destructive"],
      },
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "search_web",
          description: expect.any(String),
          effect: "read",
        }),
      ]),
    });
    expect(
      (await http.request("/api/connections/not-a-connection")).status,
    ).toBe(404);
    const gatedOAuth = await http.request("/api/connectors/gmail/oauth", {
      method: "POST",
    });
    expect(gatedOAuth.status).toBe(400);
    expect(await gatedOAuth.json()).toMatchObject({
      error: expect.stringContaining("registered Springroll OAuth client"),
    });
    expect(await (await http.request("/api/models")).json()).toMatchObject({
      models: [
        {
          providerId: "openrouter",
          modelId: "test/model",
          inputUsdPerMillionTokens: 1,
          outputUsdPerMillionTokens: 3,
        },
      ],
      catalogStale: false,
    });
    const selected = await http.request("/api/models/default", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selection: {
          providerId: "openrouter",
          modelId: "test/model",
        },
      }),
    });
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({
      defaultSelection: {
        providerId: "openrouter",
        modelId: "test/model",
      },
    });

    const proposed = await http.request("/api/tasks/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sentence: "Summarize Hacker News every morning",
        timezone: "UTC",
      }),
    });
    expect(proposed.status).toBe(200);
    const outcome = (await proposed.json()) as TaskProposalOutcomeDto;
    const proposal = readyProposal(outcome);

    const created = await http.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposal, enabled: false }),
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { readonly id: string };
    const overridden = await http.request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelSelection: {
          providerId: "openrouter",
          modelId: "test/model",
        },
      }),
    });
    expect(overridden.status).toBe(200);
    expect(await overridden.json()).toMatchObject({
      modelOverride: {
        providerId: "openrouter",
        modelId: "test/model",
      },
    });
    const execution = await http.request(`/api/tasks/${task.id}/execution`);
    expect(execution.status).toBe(200);
    expect(await execution.json()).toEqual({
      providerId: "openrouter",
      modelId: "test/model",
      selectedBy: "task",
      toolRoutes: [],
    });

    const run = await http.request(`/api/tasks/${task.id}/run`, {
      method: "POST",
      headers: { "idempotency-key": "manual-run-1" },
    });
    expect(run.status).toBe(202);
    const runBody = (await run.json()) as { readonly id: string };
    const completedRun = await waitForFinishedRun(application, runBody.id);
    expect(completedRun).toMatchObject({
      status: "succeeded",
      taskName: "Morning HN digest",
    });
    const eventPage = await http.request(
      `/api/runs/${runBody.id}/events?after=0`,
    );
    expect(eventPage.status).toBe(200);
    const eventPageBody = await eventPage.json();
    expect(eventPageBody).toMatchObject({
      runId: runBody.id,
      runStatus: "succeeded",
      hasMore: false,
      events: expect.arrayContaining([
        expect.objectContaining({ title: "Run completed" }),
      ]),
    });
    expect(JSON.stringify(eventPageBody)).not.toContain(
      "AI and local-first software led the discussion",
    );
    const eventStream = await http.request(
      `/api/runs/${runBody.id}/events/stream`,
    );
    expect(eventStream.status).toBe(200);
    expect(eventStream.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const streamBody = await eventStream.text();
    expect(streamBody).toContain("event: run_event");
    expect(streamBody).toContain("event: run_complete");
    const retriedRun = await http.request(`/api/tasks/${task.id}/run`, {
      method: "POST",
      headers: { "idempotency-key": "manual-run-1" },
    });
    expect(retriedRun.status).toBe(202);
    expect(await retriedRun.json()).toMatchObject({ id: runBody.id });
    expect((await application.snapshot()).runs).toHaveLength(1);

    const staleApproval = await http.request(
      `/api/runs/${runBody.id}/approvals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approvals: [{ id: "stale-approval", approved: true }],
        }),
      },
    );
    expect(staleApproval.status).toBe(409);

    const deletedRun = await http.request(`/api/runs/${runBody.id}`, {
      method: "DELETE",
    });
    expect(deletedRun.status).toBe(204);
    expect((await http.request(`/api/runs/${runBody.id}`)).status).toBe(404);
    const missingApproval = await http.request(
      `/api/runs/${runBody.id}/approvals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approvals: [{ id: "missing-approval", approved: true }],
        }),
      },
    );
    expect(missingApproval.status).toBe(404);
    expect((await http.request(`/api/runs/${runBody.id}/events`)).status).toBe(
      404,
    );
    expect(
      (
        await http.request(`/api/runs/${runBody.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    const replacement = await http.request(`/api/tasks/${task.id}/run`, {
      method: "POST",
      headers: { "idempotency-key": "manual-run-2" },
    });
    const replacementBody = (await replacement.json()) as {
      readonly id: string;
    };
    await waitForFinishedRun(application, replacementBody.id);
    const deletedTask = await http.request(`/api/tasks/${task.id}`, {
      method: "DELETE",
    });
    expect(deletedTask.status).toBe(204);
    expect((await http.request(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await http.request(`/api/runs/${replacementBody.id}`)).status).toBe(
      404,
    );
    expect(await (await http.request("/api/tasks")).json()).toEqual([]);
    expect(await (await http.request("/api/runs")).json()).toEqual([]);
  });

  test("marks installed connectors unavailable when their host credential disappears", async () => {
    const manifest: ConnectorManifest = {
      id: "credential-expiry-fixture",
      name: "Credential Expiry Fixture",
      blurb: "Exercises connector credential availability.",
      transport: {
        kind: "openapi",
        specUrl: "https://api.example.test/openapi.json",
        baseUrl: "https://api.example.test/v1",
      },
      credential: {
        kind: "api-key",
        placeholder: "Fixture API key",
        header: "X-API-Key",
      },
      probe: { tool: "health", input: {} },
    };
    const { application, credentials, database } = createHarness();
    const credentialRef = "connector-credential-expiry-fixture-default";
    database.db
      .insert(integrationManifests)
      .values({ id: manifest.id, manifest, createdAt: now, updatedAt: now })
      .run();
    database.db
      .insert(connectionTable)
      .values({
        id: `${manifest.id}-default`,
        name: manifest.name,
        sourceId: "openapi",
        manifestId: manifest.id,
        credentialRef,
        config: { discovery: "passed", toolCount: 1 },
        availableIn: ["local", "hosted"],
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === manifest.id,
      ),
    ).toMatchObject({
      installed: true,
      status: "not_connected",
      credentialConfigured: false,
      connectionIssue: "credential_missing",
    });

    await credentials.put(credentialRef, "fixture-secret");
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === manifest.id,
      ),
    ).toMatchObject({
      status: "connected",
      credentialConfigured: true,
    });

    await credentials.delete(credentialRef);
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === manifest.id,
      ),
    ).toMatchObject({
      status: "not_connected",
      connectionIssue: "credential_missing",
    });
  });

  test("proposes safe registry setup and persists only the selected manifest variant", async () => {
    const { application, database } = createHarness();
    const http = createHttpApp(application);

    const proposed = await http.request("/api/integrations/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence: "Connect my Neon database" }),
    });
    expect(proposed.status).toBe(200);
    expect(await proposed.json()).toMatchObject({
      status: "ready",
      proposal: {
        templateId: "neon",
        variants: [
          {
            id: "oauth",
            recommended: true,
            credentialKind: "oauth",
          },
          {
            id: "api-key",
            recommended: false,
            credentialKind: "api-key",
          },
        ],
      },
    });

    const recommended = await http.request("/api/integrations/neon/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "oauth" }),
    });
    expect(recommended.status).toBe(200);
    expect(await recommended.json()).toMatchObject({
      id: "neon",
      credentialKind: "oauth",
      setupVariantId: "oauth",
    });

    const selected = await http.request("/api/integrations/neon/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "api-key" }),
    });
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({
      id: "neon",
      status: "not_connected",
      credentialKind: "api-key",
    });
    const persisted = database.db
      .select()
      .from(integrationManifests)
      .all()
      .find((row) => row.id === "neon");
    expect(persisted?.manifest).toMatchObject({
      id: "neon",
      credential: { kind: "api-key" },
    });
    expect(JSON.stringify(persisted)).not.toContain("secret");

    database.db
      .insert(connectionTable)
      .values({
        id: "neon-default",
        name: "Neon",
        sourceId: "mcp-remote",
        manifestId: "neon",
        credentialRef: "neon-mcp-default",
        config: { disconnected: true },
        availableIn: ["local", "hosted"],
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === "neon",
      ),
    ).toMatchObject({ installed: true, removable: true });
    await expect(
      application.proposeConnectionAction("neon", "remove"),
    ).resolves.toMatchObject({
      status: "ready",
      proposal: { connectionId: "neon", removable: true },
    });
    expect(
      (await http.request("/api/connectors/neon", { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === "neon",
      ),
    ).toMatchObject({
      installed: false,
      removable: false,
      credentialKind: "oauth",
    });
    expect(
      database.db
        .select()
        .from(integrationManifests)
        .all()
        .find((row) => row.id === "neon"),
    ).toBeUndefined();

    expect(
      await (
        await http.request("/api/integrations/propose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sentence: "Connect Gmail" }),
        })
      ).json(),
    ).toMatchObject({ status: "unavailable" });
  });

  test("reviews researched official connectors before persisting them", async () => {
    const stripeManifest: ConnectorManifest = {
      id: "stripe",
      name: "Stripe",
      blurb: "<b>Payments</b> — inspect customers, products, and balances.",
      transport: { kind: "mcp-remote", endpoint: "https://mcp.stripe.com/" },
      credential: { kind: "oauth" },
      probe: { tool: "get_stripe_account_info", input: {} },
      tools: {
        allow: [
          "get_stripe_account_info",
          "retrieve_balance",
          "list_customers",
        ],
        risk: {
          get_stripe_account_info: {
            effect: "read",
            openWorld: true,
            idempotent: true,
          },
          retrieve_balance: {
            effect: "read",
            openWorld: true,
            idempotent: true,
          },
          list_customers: {
            effect: "read",
            openWorld: true,
            idempotent: true,
          },
        },
      },
    };
    const researcher: IntegrationResearcher = {
      async research() {
        return {
          status: "ready",
          integration: {
            manifest: stripeManifest,
            operator: "Stripe",
            registryName: "com.stripe/mcp",
            registryVersion: "0.2.4",
            guidance: {
              summary:
                "Sign in to Stripe and review the requested account access.",
              steps: ["Choose Sign in with Stripe.", "Approve account access."],
              docsUrl: "https://docs.stripe.com/mcp",
            },
            sources: [
              {
                title: "Stripe MCP documentation",
                url: "https://docs.stripe.com/mcp",
              },
            ],
          },
        };
      },
    };
    const { application, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      async () => Response.json({ results: [] }),
      researcher,
    );
    const http = createHttpApp(application);

    const response = await http.request("/api/integrations/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence: "Create a Stripe integration" }),
    });
    const outcome = (await response.json()) as {
      status: string;
      proposal: {
        templateId: string;
        trust: string;
        registryName: string;
        manifest: ConnectorManifest;
        tools: readonly { name: string; effect: string }[];
      };
    };
    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "registry-verified",
        registryName: "com.stripe/mcp",
        manifest: { id: "stripe", credential: { kind: "oauth" } },
        tools: [
          { name: "get_stripe_account_info", effect: "read" },
          { name: "retrieve_balance", effect: "read" },
          { name: "list_customers", effect: "read" },
        ],
      },
    });
    expect(database.db.select().from(integrationManifests).all()).toEqual([]);

    const accepted = await http.request(
      `/api/integrations/${encodeURIComponent(outcome.proposal.templateId)}/select`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId: "researched" }),
      },
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      id: "stripe",
      status: "not_connected",
      credentialKind: "oauth",
    });
    expect(database.db.select().from(integrationManifests).all()).toHaveLength(
      1,
    );
    expect(database.db.select().from(connectionTable).all()).not.toContainEqual(
      expect.objectContaining({ manifestId: "stripe" }),
    );
  });

  test("keeps an agent-researched local package reviewable until acceptance", async () => {
    const manifest: ConnectorManifest = {
      id: "microsoft-clarity",
      name: "Microsoft Clarity",
      blurb: "<b>Local</b> — read Clarity analytics from this Mac.",
      transport: {
        kind: "mcp-local",
        package: {
          registry: "npm",
          name: "@microsoft/clarity-mcp-server",
          version: "2.0.1",
        },
      },
      credential: {
        kind: "api-key",
        env: "CLARITY_API_TOKEN",
        placeholder: "Clarity Data Export API token",
      },
    };
    const localResearcher: LocalMcpIntegrationResearcher = {
      async researchLocalMcp(input) {
        expect(input.packageName).toBe("@microsoft/clarity-mcp-server");
        return {
          status: "ready",
          integration: {
            manifest,
            operator: "Microsoft",
            trust: "package-verified",
            packageName: "@microsoft/clarity-mcp-server",
            packageVersion: "2.0.1",
            guidance: input.guidance,
            sources: input.sources,
          },
        };
      },
    };
    const { application, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      async () => Response.json({ results: [] }),
      undefined,
      undefined,
      localResearcher,
    );

    const outcome = await application.proposeLocalMcpIntegration({
      name: "Microsoft Clarity",
      operator: "Microsoft",
      description: "Read Clarity analytics from this Mac.",
      packageName: "@microsoft/clarity-mcp-server",
      repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
      credential: {
        kind: "api-key",
        env: "CLARITY_API_TOKEN",
        placeholder: "Clarity Data Export API token",
      },
      guidance: {
        summary: "Generate a Data Export API token.",
        steps: ["Open Settings, then Data Export."],
        docsUrl: "https://learn.microsoft.com/clarity",
      },
      sources: [
        {
          title: "Microsoft Learn",
          url: "https://learn.microsoft.com/clarity",
        },
        {
          title: "Microsoft source",
          url: "https://github.com/microsoft/clarity-mcp-server",
        },
      ],
    });
    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "package-verified",
        packageName: "@microsoft/clarity-mcp-server",
        packageVersion: "2.0.1",
        manifest,
      },
    });
    expect(database.db.select().from(integrationManifests).all()).toEqual([]);
    if (outcome.status !== "ready") throw new Error("Expected proposal");

    await application.prepareIntegrationVariant(
      outcome.proposal.templateId,
      "researched",
      outcome.proposal.manifest,
    );
    expect(
      database.db.select().from(integrationManifests).all()[0]?.manifest,
    ).toEqual(manifest);
  });

  test("turns an unverifiable package guess into a recoverable follow-up", async () => {
    const localResearcher: LocalMcpIntegrationResearcher = {
      async researchLocalMcp() {
        throw new TypeError("npm returned 404");
      },
    };
    const { application } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      async () => Response.json({ results: [] }),
      undefined,
      undefined,
      localResearcher,
    );

    const outcome = await application.proposeLocalMcpIntegration({
      name: "Microsoft Clarity",
      operator: "Microsoft",
      description: "Read Clarity analytics.",
      packageName: "@microsoft/clarity-mcp",
      repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
      credential: { kind: "none" },
      guidance: {
        summary: "Follow the official setup instructions.",
        steps: ["Open the documentation."],
        docsUrl: "https://learn.microsoft.com/clarity",
      },
      sources: [
        {
          title: "Microsoft Learn",
          url: "https://learn.microsoft.com/clarity",
        },
        {
          title: "Microsoft source",
          url: "https://github.com/microsoft/clarity-mcp-server",
        },
      ],
    });

    expect(outcome).toMatchObject({
      status: "not_found",
      title: "I couldn't verify @microsoft/clarity-mcp",
      explanation: expect.stringContaining(
        "ask the user for an official documentation, repository, or package URL",
      ),
    });
  });

  test("extracts package and repository evidence from an official connector source", async () => {
    const fetchedInputs: unknown[] = [];
    const webSource = createNativeToolSource("native.web", [
      {
        descriptor: {
          name: "fetch_public_url",
          description: "Fetch official documentation.",
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
            additionalProperties: false,
          },
          declaredRisk: {
            effect: "read",
            openWorld: true,
            idempotent: true,
          },
        },
        async execute(input) {
          fetchedInputs.push(input);
          return {
            content: [
              "Install with npx @microsoft/clarity-mcp-server. Source: https://github.com/microsoft/clarity-mcp-server",
            ],
            structuredContent: {
              url: "https://clarity.microsoft.com/blog/mcp",
            },
          };
        },
      },
    ]);
    const { application } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      async () => Response.json({ results: [] }),
      undefined,
      [webSource],
    );

    await expect(
      application.inspectConnectorSource(
        "https://clarity.microsoft.com/blog/mcp",
      ),
    ).resolves.toMatchObject({
      sourceUrl: "https://clarity.microsoft.com/blog/mcp",
      npmPackages: ["@microsoft/clarity-mcp-server"],
      repositoryUrls: ["https://github.com/microsoft/clarity-mcp-server"],
    });
    await application.inspectConnectorSource(
      "https://github.com/microsoft/clarity-mcp-server",
    );
    await application.inspectConnectorSource(
      "https://github.com/microsoft/clarity-mcp-server/blob/main/package.json",
    );
    expect(fetchedInputs).toEqual([
      { url: "https://clarity.microsoft.com/blog/mcp" },
      {
        url: "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/HEAD/README.md",
      },
      {
        url: "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/package.json",
      },
    ]);
  });

  test("verifies and prepares Clerk's documented no-auth remote MCP", async () => {
    const docsUrl = "https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server";
    const endpoint = "https://mcp.clerk.com/mcp";
    const webSource = createNativeToolSource("native.web", [
      {
        descriptor: {
          name: "fetch_public_url",
          description: "Fetch official documentation.",
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
            additionalProperties: false,
          },
          declaredRisk: {
            effect: "read",
            openWorld: true,
            idempotent: true,
          },
        },
        async execute(input) {
          expect(input).toEqual({ url: docsUrl });
          return {
            content: [
              `Clerk's remote MCP server uses Streamable HTTP at ${endpoint}.`,
            ],
            structuredContent: { url: docsUrl },
          };
        },
      },
    ]);
    const request: FetchApi = async (input, init) => {
      expect(String(input)).toBe(endpoint);
      const body = JSON.parse(String(init?.body)) as {
        readonly id?: string | number;
        readonly method: string;
      };
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      const result =
        body.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "clerk", version: "1" },
            }
          : body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "clerk_sdk_snippet",
                    description: "Find an official Clerk SDK snippet.",
                    inputSchema: {
                      type: "object",
                      properties: { query: { type: "string" } },
                      required: ["query"],
                    },
                    annotations: { readOnlyHint: true },
                  },
                ],
              }
            : undefined;
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    };
    const { application, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      request,
      undefined,
      [webSource],
    );

    const outcome = await application.proposeRemoteMcpIntegration({
      name: "Clerk",
      operator: "Clerk",
      description: "Use Clerk's official SDK documentation tools.",
      tags: ["authentication", "developer-tools"],
      endpoint,
      docsUrl,
      credential: { kind: "none" },
    });

    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "provider-verified",
        tools: [{ name: "clerk_sdk_snippet", effect: "read" }],
        variants: [
          {
            credentialKind: "none",
            guidance: { docsUrl },
          },
        ],
      },
    });
    if (outcome.status !== "ready") {
      throw new Error("Expected a ready Clerk proposal");
    }
    await application.prepareIntegrationVariant(
      outcome.proposal.templateId,
      outcome.proposal.variants[0]?.id ?? "researched",
      outcome.proposal.manifest,
    );
    expect(
      database.db.select().from(integrationManifests).all()[0]?.manifest,
    ).toMatchObject({
      id: "clerk",
      transport: { kind: "mcp-remote", endpoint },
      credential: { kind: "none" },
    });
  });

  test("prepares a user-supplied remote MCP URL as a labeled custom connector", async () => {
    const { application, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
    );
    const http = createHttpApp(application);

    const response = await http.request("/api/connectors/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Internal Search",
        endpoint: "https://mcp.example.test/search",
        credentialKind: "oauth",
      }),
    });

    expect(response.status).toBe(200);
    const card = (await response.json()) as ConnectionCardDto;
    expect(card).toMatchObject({
      name: "Internal Search",
      status: "not_connected",
      endpoint: "https://mcp.example.test/search",
      credentialKind: "oauth",
      connectionType: "mcp",
      custom: true,
    });
    const [row] = database.db.select().from(integrationManifests).all();
    expect(row?.manifest).toMatchObject({
      id: card.id,
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.example.test/search",
      },
    });
    expect(row?.manifest.probe).toBeUndefined();
    expect(row?.manifest.tools).toBeUndefined();
  });

  test("prepares a durable researched manifest without an in-memory lookup", async () => {
    const manifest: ConnectorManifest = {
      id: "durable-research",
      name: "Durable Research",
      blurb: "<b>Verified</b> — survives an application restart.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://durable.example.test/mcp",
      },
      credential: { kind: "none" },
    };
    const { application, database } = createHarness();

    const connection = await application.prepareIntegrationVariant(
      "research-restored-workflow",
      "researched",
      manifest,
    );

    expect(connection).toMatchObject({
      id: manifest.id,
      status: "not_connected",
      credentialKind: "none",
    });
    expect(
      database.db.select().from(integrationManifests).all()[0]?.manifest,
    ).toEqual(manifest);
  });

  test("renders persisted and registry manifests and resolves OpenAPI by transport", async () => {
    const manifest: ConnectorManifest = {
      id: "inventory",
      name: "Inventory",
      blurb: "<b>Stock</b> — inspect current inventory.",
      logoUrl:
        "https://raw.githubusercontent.com/example/inventory/main/icon.png",
      logoSource: "github-repository",
      transport: {
        kind: "openapi",
        specUrl: "https://inventory.example/openapi.json",
        baseUrl: "https://inventory.example/v1",
      },
      credential: { kind: "none" },
      probe: { tool: "listItems", input: {} },
      tools: { allow: ["listItems"] },
    };
    if (manifest.transport.kind !== "openapi") {
      throw new Error("Expected an OpenAPI manifest");
    }
    const specUrl = manifest.transport.specUrl;
    const requests: string[] = [];
    const request: FetchApi = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === specUrl) {
        return Response.json({
          openapi: "3.1.0",
          info: { title: "Inventory", version: "1" },
          paths: {
            "/items": {
              get: {
                operationId: "listItems",
                summary: "List inventory items",
                responses: {
                  "200": {
                    description: "Items",
                    content: {
                      "application/json": {
                        schema: { type: "object" },
                      },
                    },
                  },
                },
              },
            },
          },
        });
      }
      return Response.json({ items: [{ id: "widget-1" }] });
    };
    const { application, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      request,
    );
    database.db
      .insert(integrationManifests)
      .values({
        id: manifest.id,
        manifest,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(connectionTable)
      .values({
        id: "inventory-default",
        name: manifest.name,
        sourceId: manifest.transport.kind,
        manifestId: manifest.id,
        credentialRef: "none",
        config: { toolCount: 1 },
        availableIn: ["local", "hosted"],
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(await application.listConnections()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "neon", status: "not_connected" }),
        expect.objectContaining({
          id: "inventory",
          name: "Inventory",
          description: "Stock — inspect current inventory.",
          logoUrl:
            "https://raw.githubusercontent.com/example/inventory/main/icon.png",
          logoSource: "github-repository",
          endpoint: "https://inventory.example/v1",
          status: "connected",
          toolCount: 1,
        }),
      ]),
    );

    const source = application.getToolSource("openapi");
    expect(source?.id).toBe("openapi");
    const session = await source?.open({
      connection: {
        id: "inventory-default",
        sourceId: "openapi",
        manifestId: manifest.id,
        credentialRef: "none",
        availableIn: ["local", "hosted"],
      },
      location: "local",
    });
    expect(await session?.listTools()).toMatchObject([
      { name: "listItems", declaredRisk: { effect: "read" } },
    ]);
    await expect(
      session?.callTool(
        "listItems",
        {},
        { taskId: "task-inventory", runId: "run-inventory" },
      ),
    ).resolves.toMatchObject({
      structuredContent: { items: [{ id: "widget-1" }] },
    });
    expect(requests).toEqual([
      "https://inventory.example/openapi.json",
      "https://inventory.example/v1/items",
    ]);
    await session?.close();
  });

  test("verifies an OpenAPI credential with an explicitly curated safe operation", async () => {
    const manifest: ConnectorManifest = {
      id: "warehouse",
      name: "Warehouse",
      blurb: "<b>Stock</b> — inspect current inventory.",
      transport: {
        kind: "openapi",
        specUrl: "https://warehouse.example/openapi.json",
        baseUrl: "https://warehouse.example/v1",
      },
      credential: {
        kind: "api-key",
        placeholder: "Your warehouse key",
        keyCreationUrl: "https://warehouse.example/keys",
        header: "x-api-key",
      },
      probe: { tool: "listItems", input: {} },
      tools: { allow: ["listItems"] },
    };
    const calls: { readonly url: string; readonly key?: string }[] = [];
    const request: FetchApi = async (input, init) => {
      const url = String(input);
      const key = new Headers(init?.headers).get("x-api-key") ?? undefined;
      calls.push({ url, ...(key ? { key } : undefined) });
      if (url.endsWith("openapi.json")) {
        return Response.json({
          openapi: "3.1.0",
          info: { title: "Warehouse", version: "1" },
          paths: {
            "/items": {
              get: {
                operationId: "listItems",
                responses: { "200": { description: "Items" } },
              },
            },
          },
        });
      }
      return Response.json({ items: [] });
    };
    const { application, credentials, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      request,
    );
    database.db
      .insert(integrationManifests)
      .values({ id: manifest.id, manifest, createdAt: now, updatedAt: now })
      .run();
    let http = createHttpApp(application);

    const missingKey = await http.request("/api/connectors/warehouse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingKey.status).toBe(400);

    const response = await http.request("/api/connectors/warehouse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "warehouse-secret" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "warehouse",
      status: "connected",
      toolCount: 1,
    });
    expect(calls).toEqual([
      { url: "https://warehouse.example/openapi.json" },
      {
        url: "https://warehouse.example/v1/items",
        key: "warehouse-secret",
      },
    ]);
    expect(credentials.values.get("connector-warehouse-default")).toBe(
      "warehouse-secret",
    );
    const persisted = database.db
      .select()
      .from(connectionTable)
      .all()
      .find((connection) => connection.manifestId === "warehouse");
    expect(JSON.stringify(persisted)).not.toContain("warehouse-secret");
    expect(persisted?.config).toMatchObject({
      discovery: "passed",
      credentialVerification: "passed",
      toolNames: ["listItems"],
    });
    await expect(
      application.proposeConnectionAction("warehouse", "disconnect"),
    ).resolves.toMatchObject({
      status: "ready",
      proposal: {
        connectionName: "Warehouse",
        action: "disconnect",
        expectedStatus: "connected",
        credentialKind: "api-key",
        toolCount: 1,
      },
    });
    await expect(
      application.proposeConnectionAction("warehouse", "reconnect"),
    ).resolves.toMatchObject({
      status: "unavailable",
      title: "Connection already connected",
    });
    expect(
      database.db.select().from(credentialAuditEvents).all(),
    ).toMatchObject([
      {
        connectorId: "warehouse",
        credentialKind: "api-key",
        action: "test",
        status: "failed",
      },
      {
        connectorId: "warehouse",
        credentialKind: "api-key",
        action: "test",
        status: "succeeded",
        failureCategory: null,
      },
    ]);
    expect(
      JSON.stringify(database.db.select().from(credentialAuditEvents).all()),
    ).not.toContain("warehouse-secret");
    const dependentTask = await application.createTask(
      {
        title: "Warehouse inventory",
        prompt: "Read the current warehouse inventory.",
        schedule: "0 8 * * *",
        scheduleLabel: "Daily at 8:00 AM",
        timezone: "UTC",
        connectionId: "warehouse-default",
        connectionName: "Warehouse",
        toolNames: ["listItems"],
        tools: [
          {
            name: "listItems",
            description: "List warehouse items",
            effect: "read",
            approval: "never",
          },
        ],
        contract: "Read inventory without changing it.",
        executionMode: "local",
        catchUpPolicy: "skip_to_next",
      },
      false,
    );

    const chat = new SqliteChatStore(database.db);
    const session = chat.createSession({ id: "chat-connection-actions" });
    const message = chat.appendMessage({
      id: "connection-actions-message",
      sessionId: session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Review these connection actions." }],
    });
    const assistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock-provider",
        modelId: "mock-model-id",
      }),
    });
    http = createHttpApp(application, undefined, assistant);
    const disconnectOutcome = await application.proposeConnectionAction(
      "warehouse",
      "disconnect",
    );
    if (disconnectOutcome.status !== "ready") {
      throw new Error("Expected a disconnect proposal");
    }
    const disconnectWorkflow = chat.recordWorkflow({
      id: "disconnect-warehouse",
      sessionId: session.id,
      sourceMessageId: message.id,
      sourceToolCallId: "disconnect-warehouse-tool-call",
      kind: "connection_action",
      payload: JSON.parse(JSON.stringify(disconnectOutcome)),
    });
    const disconnectPath = `/api/chats/${session.id}/workflows/${disconnectWorkflow.id}/accept-connection-action`;

    expect(
      (await http.request(disconnectPath, { method: "POST" })).status,
    ).toBe(200);
    expect(credentials.values.has("connector-warehouse-default")).toBe(false);
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === "warehouse",
      ),
    ).toMatchObject({ status: "not_connected", installed: true });
    await expect(
      application.proposeConnectionAction("warehouse", "reconnect"),
    ).resolves.toMatchObject({
      status: "ready",
      proposal: {
        action: "reconnect",
        expectedStatus: "not_connected",
        credentialKind: "api-key",
      },
    });

    const reconnectOutcome = await application.proposeConnectionAction(
      "warehouse",
      "reconnect",
    );
    if (reconnectOutcome.status !== "ready") {
      throw new Error("Expected a reconnect proposal");
    }
    const reconnectWorkflow = chat.recordWorkflow({
      id: "reconnect-warehouse",
      sessionId: session.id,
      sourceMessageId: message.id,
      sourceToolCallId: "reconnect-warehouse-tool-call",
      kind: "connection_action",
      payload: JSON.parse(JSON.stringify(reconnectOutcome)),
    });
    const reconnectPath = `/api/chats/${session.id}/workflows/${reconnectWorkflow.id}/accept-connection-action`;
    expect(
      await (await http.request(reconnectPath, { method: "POST" })).json(),
    ).toEqual({ action: "reconnect", status: "awaiting_api_key" });
    const reconnected = await http.request(reconnectPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "replacement-secret" }),
    });
    expect(await reconnected.json()).toMatchObject({
      action: "reconnect",
      status: "connected",
      connection: { id: "warehouse", status: "connected" },
    });
    expect(JSON.stringify(assistant.getSession(session.id))).not.toContain(
      "replacement-secret",
    );
    await application.disconnectConnector("warehouse");

    const removeOutcome = await application.proposeConnectionAction(
      "warehouse",
      "remove",
    );
    if (removeOutcome.status !== "ready") {
      throw new Error("Expected a removal proposal");
    }
    const removeWorkflow = chat.recordWorkflow({
      id: "remove-warehouse",
      sessionId: session.id,
      sourceMessageId: message.id,
      sourceToolCallId: "remove-warehouse-tool-call",
      kind: "connection_action",
      payload: JSON.parse(JSON.stringify(removeOutcome)),
    });
    const removePath = `/api/chats/${session.id}/workflows/${removeWorkflow.id}/accept-connection-action`;

    const stillUsed = await http.request(removePath, { method: "POST" });
    expect(stillUsed.status).toBe(400);
    expect(await stillUsed.json()).toEqual({
      error:
        "Warehouse is used by 1 recipe. Remove it from those recipes before removing the connector.",
    });
    await application.deleteTask(dependentTask.id);
    expect((await http.request(removePath, { method: "POST" })).status).toBe(
      200,
    );
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === "warehouse",
      ),
    ).toBeUndefined();
    expect(
      database.db
        .select()
        .from(integrationManifests)
        .all()
        .find((row) => row.id === "warehouse"),
    ).toBeUndefined();
    expect(
      database.db
        .select()
        .from(credentialAuditEvents)
        .all()
        .map(({ action, status }) => ({ action, status })),
    ).toEqual([
      { action: "test", status: "failed" },
      { action: "test", status: "succeeded" },
      { action: "revoke", status: "succeeded" },
      { action: "test", status: "succeeded" },
      { action: "revoke", status: "succeeded" },
      { action: "remove", status: "failed" },
      { action: "remove", status: "succeeded" },
    ]);
  });

  test("researches and durably connects an official OpenAPI API through chat", async () => {
    const specUrl = "https://assessorsearch.com/property-data-api/openapi.json";
    const apiCalls: { readonly url: string; readonly key?: string }[] = [];
    const spec = {
      openapi: "3.1.0",
      info: { title: "AssessorSearch Property Data API", version: "1.0.0" },
      servers: [{ url: "https://api.assessorsearch.com" }],
      security: [{ ApiKeyAuth: [] }],
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
      paths: {
        "/v1/properties": {
          get: {
            operationId: "lookup_property_v1_properties_get",
            summary: "Look up a property",
            parameters: [
              {
                name: "address",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "Lookup result" } },
          },
        },
      },
    };
    const request: FetchApi = async (input, init) => {
      const url = String(input);
      if (url === specUrl) return Response.json(spec);
      apiCalls.push({
        url,
        ...(new Headers(init?.headers).get("X-API-Key")
          ? { key: new Headers(init?.headers).get("X-API-Key") as string }
          : {}),
      });
      return Response.json({ status: "no_match" });
    };
    const nestedProposalGenerator: TaskProposalGenerator = {
      async propose() {
        throw new Error("Chat recipe drafting must not invoke another model");
      },
    };
    const assessorAgent: AgentRunner = {
      async run(runRequest) {
        expect(
          runRequest.tools
            .map((tool) => tool.descriptor.name)
            .filter((name) => name !== inspectRecipeHistoryToolName),
        ).toEqual(["lookup_property_v1_properties_get"]);
        await runRequest.tools[0]?.execute(
          { address: "4038 SW Majestic Ave, Redmond, Oregon 97756" },
          { taskId: runRequest.task.id, runId: runRequest.runId },
        );
        return {
          result: createMarkdownRunResult({
            body: "AssessorSearch property lookup completed.",
            fallbackSummary: "Property lookup completed.",
          }),
          toolCalls: [],
          usage: {
            provider: "openrouter",
            modelId: "test-model",
            billing: "metered",
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 15,
            costUsdMicros: 10,
          },
          startedAt: now,
          finishedAt: new Date(now.getTime() + 100),
        };
      },
    };
    const { application, credentials, database } = createHarness(
      nestedProposalGenerator,
      resolveModelExecution,
      assessorAgent,
      () => now,
      request,
    );
    expect(
      await application.discoverOpenApi(
        "https://assessorsearch.com/property-data-api",
      ),
    ).toMatchObject({
      status: "found",
      title: "AssessorSearch Property Data API",
      specUrl,
      baseUrl: "https://api.assessorsearch.com/",
      credential: { kind: "api-key", header: "X-API-Key" },
      documentationCandidates: ["https://assessorsearch.com/property-data-api"],
      tools: [{ name: "lookup_property_v1_properties_get", effect: "read" }],
    });
    const outcome = await application.proposeOpenApiIntegration({
      name: "Assessor Search",
      operator: "AssessorSearch",
      description: "Read nationwide public property records.",
      tags: ["property-data"],
      specUrl,
      docsUrl: "https://assessorsearch.com/property-data-api/docs",
      keyCreationUrl: "https://assessorsearch.com/dashboard",
      credentialPlaceholder: "pda_live_…",
      probe: {
        tool: "lookup_property_v1_properties_get",
        input: { address: "Springroll connector verification invalid address" },
        note: "A deliberately non-matching lookup uses zero credits.",
      },
      notes: ["Matched records consume API credits."],
      sources: [
        {
          title: "AssessorSearch API docs",
          url: "https://assessorsearch.com/property-data-api/docs",
        },
        { title: "Official OpenAPI", url: specUrl },
      ],
    });
    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "openapi-verified",
        api: { operationCount: 1 },
        manifest: {
          transport: { kind: "openapi" },
          credential: { kind: "api-key", header: "X-API-Key" },
        },
      },
    });
    if (outcome.status !== "ready") {
      throw new Error("Expected an OpenAPI proposal");
    }

    const chat = new SqliteChatStore(database.db);
    const session = chat.createSession({ id: "chat-openapi-setup" });
    const message = chat.appendMessage({
      id: "openapi-message",
      sessionId: session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Review the official API." }],
    });
    const workflow = chat.recordWorkflow({
      id: "openapi-workflow",
      sessionId: session.id,
      sourceMessageId: message.id,
      sourceToolCallId: "openapi-tool-call",
      kind: "connection_setup",
      payload: JSON.parse(JSON.stringify(outcome)),
    });
    const assistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock-provider",
        modelId: "mock-model-id",
      }),
    });
    const http = createHttpApp(application, undefined, assistant);
    const workflowPath = `/api/chats/${session.id}/workflows/${workflow.id}`;

    const prepared = await http.request(`${workflowPath}/prepare-connection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "researched" }),
    });
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({
      status: "awaiting_api_key",
      connection: {
        id: "assessor-search",
        connectionType: "api",
        credentialKind: "api-key",
      },
    });

    const connected = await http.request(`${workflowPath}/connect-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "pda_live_test_secret" }),
    });
    expect(connected.status).toBe(200);
    expect(await connected.json()).toMatchObject({
      status: "connected",
      connection: {
        id: "assessor-search",
        status: "connected",
        connectionType: "api",
        toolCount: 1,
      },
    });
    expect(credentials.values.get("connector-assessor-search-default")).toBe(
      "pda_live_test_secret",
    );
    expect(JSON.stringify(assistant.getSession(session.id))).not.toContain(
      "pda_live_test_secret",
    );
    expect(
      JSON.stringify(database.db.select().from(connectionTable).all()),
    ).not.toContain("pda_live_test_secret");

    const recipeDraft: Parameters<LocalApplication["proposeTaskDraft"]>[0] = {
      title: "Daily property lookup",
      prompt:
        "Look up property core details for 4038 SW Majestic Ave, Redmond, Oregon 97756 every morning.",
      schedule: "0 8 * * *",
      scheduleLabel: "Daily at 8:00 AM",
      timezone: "America/Los_Angeles",
      connectionId: "assessor-search",
      toolNames: ["lookup_property_v1_properties_get"],
      contract: "Read one property record without changing provider data.",
      catchUpPolicy: "skip_to_next",
    };
    await expect(
      application.proposeTaskDraft({
        ...recipeDraft,
        toolNames: ["invented_property_tool"],
      }),
    ).rejects.toThrow("selected an unavailable tool");
    await expect(
      application.proposeTaskDraft({
        ...recipeDraft,
        schedule: "not a cron expression",
      }),
    ).rejects.toThrow();
    const recipeProposal = readyProposal(
      await application.proposeTaskDraft(recipeDraft),
    );
    expect(recipeProposal).toMatchObject({
      connectionId: "assessor-search-default",
      connectionName: "Assessor Search",
      toolNames: ["lookup_property_v1_properties_get"],
      tools: [
        {
          name: "lookup_property_v1_properties_get",
          effect: "read",
        },
      ],
    });
    const task = await application.createTask(recipeProposal, false);
    const started = await application.runTaskNow(task.id, "openapi-recipe-run");
    expect(await waitForFinishedRun(application, started.id)).toMatchObject({
      status: "succeeded",
    });
    expect(apiCalls).toEqual([
      {
        url: "https://api.assessorsearch.com/v1/properties?address=Springroll+connector+verification+invalid+address",
        key: "pda_live_test_secret",
      },
      {
        url: "https://api.assessorsearch.com/v1/properties?address=4038+SW+Majestic+Ave%2C+Redmond%2C+Oregon+97756",
        key: "pda_live_test_secret",
      },
    ]);
  });

  test("prepares a manual OpenAPI spec by deriving its server and auth", async () => {
    const specUrl = "https://api.example.test/openapi.json";
    const request: FetchApi = async () =>
      Response.json({
        openapi: "3.1.0",
        info: { title: "Example Inventory", version: "1" },
        servers: [{ url: "https://api.example.test/v1" }],
        security: [{ bearerAuth: [] }],
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
        paths: {
          "/items": {
            get: {
              operationId: "listItems",
              responses: { "200": { description: "Items" } },
            },
          },
        },
      });
    const { application } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      request,
    );
    const http = createHttpApp(application);
    const response = await http.request("/api/connectors/custom/openapi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ specUrl }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Example Inventory",
      connectionType: "api",
      credentialKind: "api-key",
      endpoint: "https://api.example.test/v1",
      custom: true,
      installed: false,
    });
  });

  test("resumes standard MCP OAuth after restart and rejects a bad callback state", async () => {
    const manifest: ConnectorManifest = {
      id: "oauth-fixture",
      name: "OAuth Fixture",
      blurb: "<b>Test</b> — exercise standard MCP OAuth.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.example.test/mcp",
      },
      credential: { kind: "oauth" },
    };
    let registrationCount = 0;
    const request: FetchApi = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("oauth-protected-resource")) {
        return Response.json({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        });
      }
      if (url.pathname.includes("oauth-authorization-server")) {
        return Response.json({
          issuer: "https://auth.example.test",
          authorization_endpoint: "https://auth.example.test/authorize",
          token_endpoint: "https://auth.example.test/token",
          registration_endpoint: "https://auth.example.test/register",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      }
      if (url.pathname === "/register" && init?.method === "POST") {
        registrationCount += 1;
        const registration = JSON.parse(String(init.body)) as {
          readonly redirect_uris: readonly string[];
        };
        return Response.json({
          client_id: "springroll-dynamic-client",
          redirect_uris: registration.redirect_uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          client_name: "Springroll",
        });
      }
      if (url.pathname === "/token" && init?.method === "POST") {
        return Response.json({
          access_token: "oauth-access-secret",
          refresh_token: "oauth-refresh-secret",
          token_type: "bearer",
        });
      }
      if (url.pathname === "/mcp" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          readonly id?: string | number;
          readonly method: string;
        };
        if (body.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }
        const result =
          body.method === "initialize"
            ? {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: { name: "oauth-fixture", version: "1" },
              }
            : body.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "health",
                      description: "Check the connection",
                      inputSchema: { type: "object", properties: {} },
                      annotations: { readOnlyHint: true },
                    },
                  ],
                }
              : body.method === "tools/call"
                ? { content: [{ type: "text", text: "ok" }] }
                : undefined;
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    };
    const { application, credentials, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      request,
    );
    database.db
      .insert(integrationManifests)
      .values({ id: manifest.id, manifest, createdAt: now, updatedAt: now })
      .run();
    const http = createHttpApp(application);
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === manifest.id,
      ),
    ).toMatchObject({ oauthReady: true, status: "not_connected" });
    await credentials.put(
      "connector-oauth-fixture-default",
      "legacy-api-key-value",
    );

    const invalidReturn = await http.request(
      "/api/connectors/oauth-fixture/oauth",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnTo: "https://attacker.example/chat/1" }),
      },
    );
    expect(invalidReturn.status).toBe(400);

    const returnTo = "/chat/chat-oauth?connector=oauth-fixture";
    const started = await http.request("/api/connectors/oauth-fixture/oauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnTo }),
    });
    if (!started.ok) {
      throw new Error(await started.text());
    }
    expect(started.status).toBe(200);
    const startedBody = (await started.json()) as {
      readonly status: string;
      readonly authorizationUrl: string;
    };
    expect(startedBody.status).toBe("redirect");
    const authorizationUrl = new URL(startedBody.authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://auth.example.test/authorize",
    );
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "springroll-dynamic-client",
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/connectors/oauth-fixture/oauth/callback",
    );
    expect(registrationCount).toBe(1);
    expect(
      credentials.values.get("connector-oauth-fixture-default"),
    ).not.toContain("undefined");

    const restartedModels = new OpenRouterModelConnection(credentials, {
      fetch: async () => Response.json({ data: { label: "test-key" } }),
    });
    const restartedApplication = new LocalApplication(database.db, {
      credentials,
      models: restartedModels,
      agent,
      resolveModelExecution,
      proposalGenerator,
      openApiResearcher: new VerifiedOpenApiResearcher({ fetch: request }),
      now: () => now,
      fetch: request,
    });
    restartedApplication.ensureBuiltinConnections();
    const restartedHttp = createHttpApp(restartedApplication);

    const callback = await restartedHttp.request(
      "/api/connectors/oauth-fixture/oauth/callback?code=test-code&state=wrong-state",
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain(
      "/chat/chat-oauth?connector=oauth-fixture&oauthError=",
    );
    expect(
      database.db
        .select()
        .from(connectionTable)
        .all()
        .some((connection) => connection.manifestId === manifest.id),
    ).toBe(false);

    const validState = authorizationUrl.searchParams.get("state");
    expect(validState).toBeTruthy();
    const completed = await restartedHttp.request(
      `/api/connectors/oauth-fixture/oauth/callback?code=test-code&state=${encodeURIComponent(validState ?? "")}`,
    );
    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toBe(
      "/chat/chat-oauth?connector=oauth-fixture&oauth=connected",
    );
    expect(registrationCount).toBe(1);
    expect(
      (await restartedApplication.listConnections()).find(
        (connection) => connection.id === manifest.id,
      ),
    ).toMatchObject({ status: "connected", toolCount: 1 });
    const persisted = database.db
      .select()
      .from(connectionTable)
      .all()
      .find((connection) => connection.manifestId === manifest.id);
    expect(persisted?.config).toMatchObject({
      discovery: "passed",
      toolNames: ["health"],
    });
    expect(JSON.stringify(persisted)).not.toContain("oauth-access-secret");
    expect(credentials.values.get("connector-oauth-fixture-default")).toContain(
      "oauth-access-secret",
    );
    const oauthAudit = database.db
      .select()
      .from(credentialAuditEvents)
      .all()
      .filter((event) => event.connectorId === manifest.id);
    expect(
      oauthAudit.map(({ action, status }) => ({ action, status })),
    ).toEqual([
      { action: "oauth_start", status: "succeeded" },
      { action: "oauth_complete", status: "failed" },
      { action: "oauth_complete", status: "succeeded" },
    ]);
    expect(JSON.stringify(oauthAudit)).not.toContain("oauth-access-secret");

    await credentials.delete("connector-oauth-fixture-default");
    expect(
      (await restartedApplication.listConnections()).find(
        (connection) => connection.id === manifest.id,
      ),
    ).toMatchObject({
      installed: true,
      status: "not_connected",
      credentialConfigured: false,
      connectionIssue: "credential_missing",
    });
  });

  test("coalesces concurrent manual runs but permits an intentional later rerun", async () => {
    let executions = 0;
    let releaseFirstRun: () => void = () => {};
    let markFirstRunStarted: () => void = () => {};
    const firstRunStarted = new Promise<void>((resolve) => {
      markFirstRunStarted = resolve;
    });
    const firstRunRelease = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    const delayedAgent: AgentRunner = {
      async run(request) {
        executions += 1;
        if (executions === 1) {
          markFirstRunStarted();
          await firstRunRelease;
        }
        return agent.run(request);
      },
    };
    let currentTime = now.getTime();
    const { application } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      delayedAgent,
      () => new Date(currentTime),
    );
    const proposal = readyProposal(
      await application.proposeTask(
        "Summarize Hacker News every morning",
        "UTC",
      ),
    );
    const task = await application.createTask(proposal, false);
    const http = createHttpApp(application);

    const first = application.runTaskNow(task.id, "manual-run-1");
    await firstRunStarted;
    const firstResult = await first;
    const activeRunDeletion = await http.request(
      `/api/runs/${firstResult.id}`,
      { method: "DELETE" },
    );
    expect(activeRunDeletion.status).toBe(409);
    expect(await activeRunDeletion.json()).toEqual({
      error: "A run cannot be deleted while it is still active",
    });
    const activeTaskDeletion = await http.request(`/api/tasks/${task.id}`, {
      method: "DELETE",
    });
    expect(activeTaskDeletion.status).toBe(409);
    expect(await activeTaskDeletion.json()).toEqual({
      error: "A task cannot be deleted while one of its runs is active",
    });
    const concurrent = application.runTaskNow(task.id, "manual-run-2");
    const concurrentResult = await concurrent;

    expect(concurrentResult.id).toBe(firstResult.id);
    expect(executions).toBe(1);
    expect((await application.snapshot()).runs).toHaveLength(1);
    expect((await application.getRun(firstResult.id))?.status).toBe("running");

    const retried = await application.runTaskNow(task.id, "manual-run-1");
    expect(retried.id).toBe(firstResult.id);
    expect(executions).toBe(1);

    releaseFirstRun();
    await waitForFinishedRun(application, firstResult.id);
    currentTime += 1;
    const intentional = await application.runTaskNow(task.id, "manual-run-3");
    expect(intentional.id).not.toBe(firstResult.id);
    await waitForFinishedRun(application, intentional.id);
    expect(executions).toBe(2);
    expect((await application.snapshot()).runs).toHaveLength(2);
  });

  test("returns a useful validation error for malformed proposals", async () => {
    const { application } = createHarness();
    const http = createHttpApp(application);

    const response = await http.request("/api/tasks/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence: "x", timezone: "UTC" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Describe the task in 3 to 2,000 characters",
    });
  });

  test("does not cache local browser assets across rebuilds", async () => {
    const { application } = createHarness();
    const http = createHttpApp(application, {
      indexHtml: "<!doctype html><title>Springroll</title>",
      async read(path) {
        return path === "main.js"
          ? new Response("export const version = 1", {
              headers: { "content-type": "text/javascript" },
            })
          : undefined;
      },
    });

    const asset = await http.request("/assets/main.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("no-store");
    expect(await asset.text()).toBe("export const version = 1");
    const page = await http.request("/runs/example");
    expect(page.headers.get("cache-control")).toBe("no-store");
  });

  test("returns honest unavailable outcomes without selecting an unrelated tool", async () => {
    const unavailableGenerator: TaskProposalGenerator = {
      async propose(input) {
        return input.sentence.includes("Gmail")
          ? {
              status: "needs_integration",
              title: "Gmail access is needed",
              explanation:
                "This task needs access to a private inbox, and no available tool can read it.",
              missingCapability: "gmail.read",
              suggestedIntegration: "Gmail",
              supportedAlternative:
                "I can create a public-web research report without reading private email.",
            }
          : {
              status: "unsupported",
              title: "Purchasing is not supported",
              explanation:
                "Springroll cannot complete purchases or submit checkout forms.",
              supportedAlternative:
                "I can research current prices and report the best public options.",
            };
      },
    };
    const { application } = createHarness(unavailableGenerator);

    await expect(
      application.proposeTask("Summarize my Gmail every morning", "UTC"),
    ).resolves.toEqual({
      status: "needs_integration",
      title: "Gmail access is needed",
      explanation:
        "This task needs access to a private inbox, and no available tool can read it.",
      missingCapability: "gmail.read",
      suggestedIntegration: "Gmail",
      supportedAlternative:
        "I can create a public-web research report without reading private email.",
    });
    await expect(
      application.proposeTask("Buy the cheapest ticket every Friday", "UTC"),
    ).resolves.toEqual({
      status: "unsupported",
      title: "Purchasing is not supported",
      explanation:
        "Springroll cannot complete purchases or submit checkout forms.",
      supportedAlternative:
        "I can research current prices and report the best public options.",
    });
    expect((await application.snapshot()).tasks).toHaveLength(0);
  });

  test("preflights execution before creating a manual run", async () => {
    let resolutions = 0;
    const { application } = createHarness(
      proposalGenerator,
      async (selection, capabilities) => {
        resolutions += 1;
        if (resolutions > 1) {
          throw new Error("The selected model is no longer connected");
        }
        return resolveModelExecution(selection, capabilities);
      },
    );
    const proposal = readyProposal(
      await application.proposeTask(
        "Summarize Hacker News every morning",
        "UTC",
      ),
    );
    const task = await application.createTask(proposal, false);

    await expect(application.runTaskNow(task.id)).rejects.toThrow(
      "The selected model is no longer connected",
    );
    expect((await application.snapshot()).runs).toHaveLength(0);
  });

  test("offers real web search and fetch capabilities for general web tasks", async () => {
    const webProposalGenerator: TaskProposalGenerator = {
      async propose(input) {
        const web = input.connections.find(
          (connection) => connection.id === webConnectionId,
        );
        expect(web).toEqual({
          id: webConnectionId,
          name: "Web",
          tools: [
            {
              name: "search_web",
              description:
                "Search the public web and return compact, query-relevant source excerpts. For current facts, include the exact host date in the query, reject pages whose own date conflicts, and fetch an authoritative result URL directly before answering.",
            },
            {
              name: "fetch_public_url",
              description:
                "Fetch a public HTML, JSON, XML, or text URL directly from its origin without using a search-index cache. Use this after discovery for authoritative or current facts. Verify the source's own observation/update timestamp because retrieval time alone does not make page content current.",
            },
          ],
        });

        return {
          status: "ready",
          proposal: {
            title: "Daily search-trends report",
            prompt: input.sentence,
            schedule: "0 8 * * *",
            scheduleLabel: "Daily at 8:00 AM",
            timezone: input.timezone,
            connectionId: webConnectionId,
            toolNames: ["search_web", "fetch_public_url"],
            contract:
              "I will search and read public web sources for current trends and cite what I find. I cannot access private accounts or change anything.",
            catchUpPolicy: "skip_to_next",
          },
        };
      },
    };
    const { application } = createHarness(webProposalGenerator);

    const proposal = readyProposal(
      await application.proposeTask(
        "Check Google Trends daily and produce a cited report on the most searched and fastest-rising topics.",
        "America/Los_Angeles",
      ),
    );

    expect(proposal).toMatchObject({
      title: "Daily search-trends report",
      connectionName: "Web",
      toolNames: ["search_web", "fetch_public_url"],
      tools: [
        { name: "search_web", effect: "read" },
        { name: "fetch_public_url", effect: "read" },
      ],
      modelExecution: {
        providerId: "openrouter",
        modelId: "test/model",
        selectedBy: "automatic",
        toolRoutes: [
          {
            capability: "web.search",
            profile: "portable",
            service: "exa",
          },
          {
            capability: "web.fetch",
            profile: "portable",
            service: "exa",
          },
        ],
      },
    });
    const task = await application.createTask(proposal, false);
    expect(task.connectionNames).toEqual(["Web"]);
  });

  test("migrates only the explicitly compatible built-in web pin revision", async () => {
    const webProposalGenerator: TaskProposalGenerator = {
      async propose(input) {
        return {
          status: "ready",
          proposal: {
            title: "Current weather",
            prompt: input.sentence,
            schedule: "0 8 * * *",
            scheduleLabel: "Daily at 8:00 AM",
            timezone: input.timezone,
            connectionId: webConnectionId,
            toolNames: ["search_web"],
            contract: "Search public sources without changing anything.",
            catchUpPolicy: "skip_to_next",
          },
        };
      },
    };
    const { application, database } = createHarness(webProposalGenerator);
    const task = await application.createTask(
      readyProposal(
        await application.proposeTask("Check current weather", "UTC"),
      ),
      false,
    );
    const oldHash =
      "520ff7effaa3435169b145f48457c13280fc8a1e407dd64267bada1b54deb2bf";
    database.db.update(taskToolTable).set({ inputSchemaHash: oldHash }).run();

    expect(await application.migrateBuiltInToolPins()).toBe(1);
    expect(
      database.db
        .select()
        .from(taskToolTable)
        .all()
        .find((pin) => pin.taskId === task.id)?.inputSchemaHash,
    ).toBe("a3dfac69fa40055505dbf2dead554fff4bef28aa078941f2de47ce2f76530151");
    expect(await application.migrateBuiltInToolPins()).toBe(0);
    database.db
      .update(taskToolTable)
      .set({ inputSchemaHash: oldHash, riskEffect: "write" })
      .run();
    expect(await application.migrateBuiltInToolPins()).toBe(0);
    database.db
      .update(taskToolTable)
      .set({
        inputSchemaHash:
          "a3dfac69fa40055505dbf2dead554fff4bef28aa078941f2de47ce2f76530151",
        riskEffect: "read",
      })
      .run();
    await expect(application.getTaskExecution(task.id)).resolves.toBeDefined();
  });

  test("reviews live external tool drift before repairing a recipe pin", async () => {
    let descriptor: ToolDescriptor = {
      name: "read_fixture",
      description: "Read fixture records",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      declaredRisk: {
        effect: "read",
        openWorld: true,
        idempotent: true,
      },
    };
    const source: ToolSource = {
      id: "native.drifting-fixture",
      kind: "native",
      async open() {
        return {
          async listTools() {
            return [descriptor];
          },
          async callTool() {
            return { content: [] };
          },
          async close() {},
        };
      },
    };
    const driftingProposalGenerator: TaskProposalGenerator = {
      async propose(input) {
        return {
          status: "ready",
          proposal: {
            title: "Fixture reader",
            prompt: input.sentence,
            schedule: "0 8 * * *",
            scheduleLabel: "Daily at 8:00 AM",
            timezone: input.timezone,
            connectionId: "drifting-fixture",
            toolNames: ["read_fixture"],
            contract: "Read fixture records.",
            catchUpPolicy: "skip_to_next",
          },
        };
      },
    };
    const { application, database } = createHarness(
      driftingProposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      async () => Response.json({ results: [] }),
      undefined,
      [source],
    );
    database.db
      .insert(connectionTable)
      .values({
        id: "drifting-fixture",
        name: "Drifting fixture",
        sourceId: source.id,
        credentialRef: "none",
        config: {},
        availableIn: ["local"],
      })
      .run();
    const task = await application.createTask(
      readyProposal(
        await application.proposeTask("Read fixture records", "UTC"),
      ),
      false,
    );
    descriptor = {
      ...descriptor,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1 },
        },
        required: ["query"],
      },
      declaredRisk: {
        effect: "write",
        openWorld: true,
        idempotent: false,
      },
    };

    await expect(application.getTaskExecution(task.id)).rejects.toThrow(
      "Pinned tool schema changed",
    );
    const outcome = await application.proposeTaskToolRepair(task.id);
    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        taskId: task.id,
        changes: [
          {
            sourceId: source.id,
            toolName: "read_fixture",
            previousRisk: { effect: "read" },
            proposedRisk: { effect: "write" },
          },
        ],
      },
    });
    if (outcome.status !== "ready") {
      throw new Error("Expected a tool repair proposal");
    }

    const chat = new SqliteChatStore(database.db);
    const session = chat.createSession({ id: "chat-tool-repair" });
    const message = chat.appendMessage({
      id: "tool-repair-message",
      sessionId: session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Review this tool repair." }],
    });
    const workflow = chat.recordWorkflow({
      id: "tool-repair-workflow-1",
      sessionId: session.id,
      sourceMessageId: message.id,
      sourceToolCallId: "tool-repair-call-1",
      kind: "task_repair",
      payload: JSON.parse(JSON.stringify(outcome)),
    });
    const assistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock-provider",
        modelId: "mock-model-id",
      }),
    });
    const http = createHttpApp(application, undefined, assistant);
    const response = await http.request(
      `/api/chats/${session.id}/workflows/${workflow.id}/accept-task-repair`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(assistant.getSession(session.id)?.workflows).toMatchObject([
      {
        status: "completed",
        subjectKind: "task",
        subjectId: task.id,
        outcome: {
          repaired: true,
          tools: [`${source.id}/read_fixture`],
        },
      },
    ]);
    await expect(application.getTaskExecution(task.id)).resolves.toBeDefined();
    expect(
      database.db
        .select()
        .from(taskToolTable)
        .all()
        .find((pin) => pin.taskId === task.id),
    ).toMatchObject({
      riskEffect: "write",
      riskOpenWorld: true,
      riskIdempotent: false,
      approval: "never",
    });
    await expect(
      application.proposeTaskAction(task.id, "run_now"),
    ).resolves.toMatchObject({
      status: "ready",
      proposal: { action: "run_now" },
    });
    await expect(
      application.proposeTaskAction(task.id, "resume"),
    ).resolves.toMatchObject({
      status: "ready",
      proposal: { action: "resume" },
    });
    await expect(application.runTaskNow(task.id)).resolves.toMatchObject({
      id: expect.any(String),
    });
    await expect(
      application.updateTask(task.id, { enabled: true }),
    ).resolves.toMatchObject({ enabled: true });
    expect(
      (await application.listRuns()).filter((run) => run.taskId === task.id),
    ).toHaveLength(1);
  });

  test("does not recreate Hacker News while proposing the same recipe through available web tools", async () => {
    const webFallbackGenerator: TaskProposalGenerator = {
      async propose(input) {
        expect(input.connections.map((connection) => connection.id)).toEqual([
          webConnectionId,
        ]);
        return {
          status: "ready",
          proposal: {
            title: "Daily Hacker News digest",
            prompt: input.sentence,
            schedule: "0 9 * * *",
            scheduleLabel: "Daily at 9:00 AM",
            timezone: input.timezone,
            connectionId: webConnectionId,
            toolNames: ["search_web", "fetch_public_url"],
            contract:
              "I will use public web search and direct page reads to summarize current Hacker News stories.",
            catchUpPolicy: "skip_to_next",
          },
        };
      },
    };
    const { application, database } = createHarness(
      webFallbackGenerator,
      resolveModelExecution,
      agent,
      () => now,
      async () => Response.json({ results: [] }),
      undefined,
      undefined,
      undefined,
      false,
    );

    const proposal = readyProposal(
      await application.proposeTask(
        "Summarize the top Hacker News stories every morning",
        "America/Los_Angeles",
      ),
    );

    expect(proposal).toMatchObject({
      connectionId: webConnectionId,
      connectionName: "Web",
      toolNames: ["search_web", "fetch_public_url"],
    });
    expect(
      database.db
        .select()
        .from(connectionTable)
        .all()
        .some((connection) => connection.sourceId === hackerNewsSourceId),
    ).toBe(false);
  });

  test("describes connected ToolSources and separates read from mutation calls", async () => {
    const fetch: FetchApi = async (input) => {
      const url = String(input);
      if (url.endsWith("/topstories.json")) return Response.json([123]);
      if (url.endsWith("/item/123.json")) {
        return Response.json({
          id: 123,
          type: "story",
          title: "A careful local agent",
          by: "springroll",
          score: 42,
          time: 1_754_000_000,
        });
      }
      return Response.json({ results: [] });
    };
    let writeCalls = 0;
    const writeSource = createNativeToolSource("native.write-test", [
      {
        descriptor: {
          name: "change_remote_state",
          description: "Change remote state.",
          inputSchema: { type: "object", properties: {} },
          declaredRisk: {
            effect: "write",
            openWorld: true,
            idempotent: false,
          },
        },
        async execute() {
          writeCalls += 1;
          return { content: [{ type: "text", text: "changed" }] };
        },
      },
    ]);
    const unavailableSource: ToolSource = {
      id: "native.unavailable-search-test",
      kind: "native",
      async open() {
        throw new Error("provider detail that must stay hidden");
      },
    };
    const { application, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => now,
      fetch,
      undefined,
      [writeSource, unavailableSource],
    );
    database.db
      .insert(connectionTable)
      .values({
        id: "write-test",
        name: "Write test",
        sourceId: writeSource.id,
        credentialRef: "none",
        config: {},
        availableIn: ["local"],
      })
      .run();
    database.db
      .insert(connectionTable)
      .values({
        id: "unavailable-search-test",
        name: "Unavailable search test",
        sourceId: unavailableSource.id,
        credentialRef: "none",
        config: {},
        availableIn: ["local"],
      })
      .run();

    const described = await application.describeConnectionTools(
      hackerNewsConnectionId,
    );
    expect(described).toMatchObject({
      connectionId: hackerNewsConnectionId,
      connectionName: "Hacker News",
      tools: [
        {
          name: "get_hacker_news_top_stories",
          risk: { effect: "read", openWorld: true, idempotent: true },
        },
      ],
    });
    const searched = await application.searchConnectionTools(
      "change remote state",
    );
    expect(searched).toMatchObject({
      query: "change remote state",
      matches: [
        {
          connectionId: "write-test",
          connectionName: "Write test",
          toolName: "change_remote_state",
          effect: "write",
        },
      ],
    });
    expect(searched.searchedConnections).toBeGreaterThanOrEqual(2);
    expect(searched.unavailableConnections).toBe(1);
    expect(JSON.stringify(searched)).not.toContain("provider detail");
    const activated = await application.activateConnectionTools("write-test", [
      "change_remote_state",
    ]);
    expect(activated).toEqual({
      connectionId: "write-test",
      connectionName: "Write test",
      tools: [
        {
          name: "change_remote_state",
          description: "Change remote state.",
          inputSchema: { type: "object", properties: {} },
          risk: { effect: "write", openWorld: true, idempotent: false },
        },
      ],
    });
    await expect(
      application.activateConnectionTools("write-test", ["missing_tool"]),
    ).rejects.toThrow("Connection tools are unavailable: missing_tool");
    const result = await application.callReadConnectionTool(
      hackerNewsConnectionId,
      "get_hacker_news_top_stories",
      { limit: 1 },
    );
    expect(result.structuredContent).toMatchObject({
      stories: [{ id: 123, title: "A careful local agent" }],
    });

    await expect(
      application.callReadConnectionTool(
        "write-test",
        "change_remote_state",
        {},
      ),
    ).rejects.toThrow("requires proposal and approval");
    expect(writeCalls).toBe(0);
    await expect(
      application.callConnectionTool(
        hackerNewsConnectionId,
        "get_hacker_news_top_stories",
        { limit: 1 },
      ),
    ).rejects.toThrow("exceptional approval path");
    await expect(
      application.callWriteConnectionTool(
        "write-test",
        "change_remote_state",
        {},
      ),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "changed" }],
    });
    expect(writeCalls).toBe(1);

    const writeProposal = await application.proposeTaskDraft({
      title: "Change remote state",
      prompt: "Change the remote state every morning.",
      schedule: "0 8 * * *",
      scheduleLabel: "Daily at 8:00 AM",
      timezone: "UTC",
      connectionId: "write-test",
      toolNames: ["change_remote_state"],
      contract: "Change remote state as scheduled.",
      catchUpPolicy: "skip_to_next",
    });
    expect(writeProposal.proposal.tools).toEqual([
      expect.objectContaining({
        name: "change_remote_state",
        effect: "write",
        approval: "never",
      }),
    ]);
    await expect(
      application.createTask(writeProposal.proposal, true),
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      application.createTask(writeProposal.proposal, false),
    ).resolves.toMatchObject({ enabled: false });
  });

  test("summarizes approvals, usage, and application state without exposing payloads", async () => {
    const { application, database } = createHarness();
    const secret = "never-show-this-approval-input";
    database.db
      .insert(toolApprovalTable)
      .values({
        id: "approval-summary-1",
        contextKind: "chat",
        contextId: "turn-summary-1",
        toolCallId: "tool-call-summary-1",
        toolName: "create_external_record",
        input: { apiKey: secret, value: "sensitive payload" },
        riskEffect: "write",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(modelCalls)
      .values([
        {
          id: "usage-chat-1",
          contextKind: "chat",
          contextId: "turn-summary-1",
          sequence: 1,
          status: "succeeded",
          provider: "openrouter",
          modelId: "test/model",
          billing: "metered",
          inputTokens: 100,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedInputTokens: 10,
          totalTokens: 120,
          costUsdMicros: 50,
          actualCostUsdMicros: 50,
          estimatedCostUsdMicros: 45,
          webSearchRequests: 1,
          providerToolCalls: 2,
          startedAt: now,
          finishedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "usage-run-1",
          contextKind: "run",
          contextId: "run-summary-1",
          sequence: 1,
          status: "failed",
          provider: "openrouter",
          modelId: "test/model",
          billing: "metered",
          inputTokens: 40,
          outputTokens: 5,
          totalTokens: 45,
          costUsdMicros: 20,
          estimatedCostUsdMicros: 20,
          webSearchRequests: 0,
          providerToolCalls: 1,
          startedAt: now,
          finishedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const approvals = await application.listApprovalSummaries("pending", 10);
    expect(approvals).toEqual({
      approvals: [
        {
          id: "approval-summary-1",
          contextKind: "chat",
          contextId: "turn-summary-1",
          toolName: "create_external_record",
          riskEffect: "write",
          status: "pending",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(approvals)).not.toContain(secret);
    expect(JSON.stringify(approvals)).not.toContain("sensitive payload");

    expect(application.usageSummary()).toEqual({
      calls: {
        total: 2,
        started: 0,
        succeeded: 1,
        failed: 1,
        cancelled: 0,
      },
      tokens: {
        input: 140,
        output: 25,
        reasoning: 5,
        cachedInput: 10,
        total: 165,
      },
      costUsdMicros: { recorded: 70, actual: 50, estimated: 65 },
      webSearchRequests: 1,
      providerToolCalls: 3,
    });
    expect(application.usageSummary("chat")).toMatchObject({
      contextKind: "chat",
      calls: { total: 1, succeeded: 1, failed: 0 },
      tokens: { total: 120 },
      costUsdMicros: { recorded: 50, actual: 50, estimated: 45 },
    });

    expect(await application.applicationState()).toMatchObject({
      tasks: { total: 0, enabled: 0, paused: 0 },
      runs: { total: 0 },
      connections: { total: 1, connected: 0, needsAttention: 1 },
      pendingApprovals: 1,
    });
  });

  test("exposes persisted assistant sessions through the HTTP boundary", async () => {
    const { application, database } = createHarness();
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "activate-app-tool",
                toolName: "springroll_activate_application_tools",
                input: JSON.stringify({
                  toolNames: ["springroll_describe_connection_tools"],
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage: {
                  inputTokens: {
                    total: 7,
                    noCache: 7,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "describe-call",
                toolName: "springroll_describe_connection_tools",
                input: JSON.stringify({
                  connectionId: hackerNewsConnectionId,
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage: {
                  inputTokens: {
                    total: 7,
                    noCache: 7,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              {
                type: "text-delta",
                id: "text-1",
                delta: "I checked your connections and can guide you.",
              },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                  inputTokens: {
                    total: 7,
                    noCache: 7,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
              },
            ],
          }),
        },
      ],
    });
    const assistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model,
        provider: "mock-provider",
        modelId: "mock-model-id",
        tools: createSpringrollApplicationTools(application),
      }),
    });
    const http = createHttpApp(application, undefined, assistant);

    const connectionEntry = {
      context: {
        version: 1,
        intent: "connection.manage",
        origin: "connections",
        subjects: [{ kind: "connection", id: "web-search" }],
        suggestedPrompt: "Help me understand this connection.",
      },
    };
    const entryResponse = await http.request("/api/chats/entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(connectionEntry),
    });
    expect(entryResponse.status).toBe(201);
    const entry = (await entryResponse.json()) as {
      readonly id: string;
      readonly context: unknown;
    };
    expect(entry.context).toEqual(connectionEntry.context);
    expect(entry).not.toHaveProperty("contextKey");
    const resumedResponse = await http.request("/api/chats/entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        context: { ...connectionEntry.context, origin: "chat" },
      }),
    });
    expect((await resumedResponse.json()).id).toBe(entry.id);
    const contextUpdate = await http.request(`/api/chats/${entry.id}/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        intent: "general",
        origin: "chat",
        subjects: [],
      }),
    });
    expect(contextUpdate.status).toBe(200);
    expect(await contextUpdate.json()).toMatchObject({
      id: entry.id,
      context: { intent: "general", subjects: [] },
    });
    const invalidEntry = await http.request("/api/chats/entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        context: {
          version: 1,
          intent: "run.diagnose",
          origin: "runs",
          subjects: [{ kind: "run", id: "missing-run" }],
        },
      }),
    });
    expect(invalidEntry.status).toBe(400);
    expect(await invalidEntry.json()).toMatchObject({
      error: "Unknown run: missing-run",
    });

    const createdResponse = await http.request("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Connect Clarity" }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string };

    const streamResponse = await http.request(
      `/api/chats/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            id: "client-message",
            role: "user",
            parts: [{ type: "text", text: "Connect Microsoft Clarity" }],
          },
        }),
      },
    );
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    expect(await streamResponse.text()).toContain(
      "I checked your connections and can guide you.",
    );
    expect(model.doStreamCalls).toHaveLength(3);
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain(
      "get_hacker_news_top_stories",
    );

    const detailResponse = await http.request(`/api/chats/${created.id}`);
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      session: { id: created.id, title: "Connect Clarity", activeTurnId: null },
      messages: [{ role: "user" }, { role: "assistant" }],
      turns: [{ status: "completed", error: null }],
      usage: { inputTokens: 21, outputTokens: 12, totalTokens: 33 },
    });

    const renameResponse = await http.request(`/api/chats/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Clarity setup" }),
    });
    expect(renameResponse.status).toBe(200);
    expect(await renameResponse.json()).toMatchObject({
      id: created.id,
      title: "Clarity setup",
      status: "active",
    });
    expect(
      (
        await http.request(`/api/chats/${created.id}/cancel`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const archiveResponse = await http.request(`/api/chats/${created.id}`, {
      method: "DELETE",
    });
    expect(archiveResponse.status).toBe(204);
    const restoreResponse = await http.request(`/api/chats/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    expect(restoreResponse.status).toBe(200);
    expect(await restoreResponse.json()).toMatchObject({
      id: created.id,
      status: "active",
    });
    expect(
      (await http.request(`/api/chats/${created.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect(
      (
        await http.request(`/api/chats/${created.id}/permanent`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect((await http.request(`/api/chats/${created.id}`)).status).toBe(404);

    const missingResponse = await http.request(
      "/api/chats/not-found/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            id: "missing",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        }),
      },
    );
    expect(missingResponse.status).toBe(404);
  });

  test("accepts bounded approval decisions through the chat HTTP boundary", async () => {
    const calls: unknown[] = [];
    const assistant = {
      async respond(sessionId: string, value: unknown) {
        calls.push({ sessionId, value });
        return new Response("approved-stream", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    } as unknown as AssistantApi;
    const http = createHttpApp({} as LocalApplication, undefined, assistant);

    const response = await http.request("/api/chats/chat-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvals: [
          {
            id: "approval-1",
            approved: false,
            reason: "Keep the existing record",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("approved-stream");
    expect(calls).toEqual([
      {
        sessionId: "chat-1",
        value: {
          approvals: [
            {
              id: "approval-1",
              approved: false,
              reason: "Keep the existing record",
            },
          ],
        },
      },
    ]);
  });

  test("creates a paused recipe then runs or enables it through durable native follow-ups", async () => {
    const { application, database } = createHarness();
    const proposal = readyProposal(
      await application.proposeTask(
        "Summarize Hacker News each morning",
        "UTC",
      ),
    );
    const chat = new SqliteChatStore(database.db);
    const session = chat.createSession({ id: "chat-recipe-workflow" });
    const message = chat.appendMessage({
      id: "recipe-proposal-message",
      sessionId: session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Review this recipe." }],
    });
    expect(proposal.tools).toEqual([
      expect.objectContaining({ approval: "never", effect: "read" }),
    ]);
    const legacyPayload = JSON.parse(
      JSON.stringify({ status: "ready", proposal }),
    );
    delete legacyPayload.proposal.tools[0].approval;
    const workflow = chat.recordWorkflow({
      id: "recipe-workflow-1",
      sessionId: session.id,
      sourceMessageId: message.id,
      sourceToolCallId: "recipe-tool-call-1",
      kind: "task_proposal",
      payload: legacyPayload,
    });
    const assistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock-provider",
        modelId: "mock-model-id",
      }),
    });
    const http = createHttpApp(application, undefined, assistant);
    const path = `/api/chats/${session.id}/workflows/${workflow.id}/accept-task`;

    const accepted = await http.request(path, { method: "POST" });
    expect(accepted.status).toBe(201);
    const task = (await accepted.json()) as { id: string; enabled: boolean };
    expect(task).toEqual(
      expect.objectContaining({
        id: workflow.id,
        enabled: false,
      }),
    );
    expect(assistant.getSession(session.id)?.workflows).toMatchObject([
      {
        id: workflow.id,
        status: "completed",
        subjectKind: "task",
        subjectId: workflow.id,
        outcome: { created: true, enabled: false },
      },
    ]);
    expect(assistant.getSession(session.id)?.session.context).toMatchObject({
      intent: "task.manage",
      subjects: [{ kind: "task", id: workflow.id }],
    });

    const repeated = await http.request(path, { method: "POST" });
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).id).toBe(workflow.id);
    expect(await application.listTasks()).toHaveLength(1);

    const followUpPath = `/api/chats/${session.id}/workflows/${workflow.id}/accept-created-task-action`;
    const started = await http.request(followUpPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run_now" }),
    });
    expect(started.status).toBe(202);
    const startedBody = (await started.json()) as {
      action: string;
      run: { id: string };
    };
    expect(startedBody).toMatchObject({ action: "run_now" });
    const restoredAssistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock-provider",
        modelId: "mock-model-id",
      }),
    });
    const restoredHttp = createHttpApp(
      application,
      undefined,
      restoredAssistant,
    );
    const repeatedRun = await restoredHttp.request(followUpPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run_now" }),
    });
    expect(await repeatedRun.json()).toEqual(startedBody);

    await application.updateTask(task.id, {
      prompt: "This recipe was edited after its original review.",
    });
    const staleEnable = await restoredHttp.request(followUpPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });
    expect(staleEnable.status).toBe(409);
    expect(await staleEnable.json()).toMatchObject({
      error: expect.stringContaining("changed after it was reviewed"),
    });
    await application.updateTask(task.id, { prompt: proposal.prompt });
    const enabled = await restoredHttp.request(followUpPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });
    expect(await enabled.json()).toMatchObject({
      action: "resume",
      task: { id: workflow.id, enabled: true },
    });
    const repeatedEnable = await restoredHttp.request(followUpPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });
    expect(await repeatedEnable.json()).toMatchObject({
      action: "resume",
      task: { id: workflow.id, enabled: true },
    });
    expect(
      (await application.listRuns()).filter((run) => run.taskId === task.id),
    ).toHaveLength(1);
    expect(restoredAssistant.getSession(session.id)?.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `${workflow.id}:run_now`,
          kind: "task_action",
          status: "completed",
          subjectKind: "run",
          subjectId: startedBody.run.id,
        }),
        expect.objectContaining({
          id: `${workflow.id}:resume`,
          kind: "task_action",
          status: "completed",
          subjectKind: "task",
          subjectId: workflow.id,
        }),
      ]),
    );
    expect(
      restoredAssistant.getSession(session.id)?.session.context,
    ).toMatchObject({
      intent: "task.manage",
      subjects: [{ kind: "task", id: workflow.id }],
    });
  });

  test("reviews and applies a durable update to an existing recipe", async () => {
    const { application, database } = createHarness();
    const originalProposal = readyProposal(
      await application.proposeTask("Summarize Hacker News daily", "UTC"),
    );
    const original = await application.createTask(originalProposal, false);
    const outcome = await application.proposeTaskUpdate(original.id, {
      prompt: "Summarize Hacker News daily and use Rapid City, South Dakota.",
    });
    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        taskId: original.id,
        changes: [
          {
            field: "prompt",
            label: "Instructions",
            before: original.prompt,
            after:
              "Summarize Hacker News daily and use Rapid City, South Dakota.",
          },
        ],
      },
    });
    if (outcome.status !== "ready") {
      throw new Error("Expected a recipe update proposal");
    }

    const chat = new SqliteChatStore(database.db);
    const session = chat.createSession({ id: "chat-recipe-update" });
    const message = chat.appendMessage({
      id: "recipe-update-message",
      sessionId: session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Review this recipe update." }],
    });
    const workflow = chat.recordWorkflow({
      id: "recipe-update-workflow-1",
      sessionId: session.id,
      sourceMessageId: message.id,
      sourceToolCallId: "recipe-update-tool-call-1",
      kind: "task_update",
      payload: JSON.parse(JSON.stringify(outcome)),
    });
    const assistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock-provider",
        modelId: "mock-model-id",
      }),
    });
    const http = createHttpApp(application, undefined, assistant);
    const path = `/api/chats/${session.id}/workflows/${workflow.id}/accept-task-update`;

    const accepted = await http.request(path, { method: "POST" });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      id: original.id,
      prompt: "Summarize Hacker News daily and use Rapid City, South Dakota.",
      enabled: false,
    });
    expect(assistant.getSession(session.id)?.workflows).toMatchObject([
      {
        id: workflow.id,
        status: "completed",
        subjectKind: "task",
        subjectId: original.id,
        outcome: { updated: true, fields: ["prompt"] },
      },
    ]);
    expect(assistant.getSession(session.id)?.session.context).toMatchObject({
      intent: "task.manage",
      subjects: [{ kind: "task", id: original.id }],
    });

    const repeated = await http.request(path, { method: "POST" });
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).id).toBe(original.id);
  });

  test("confirms durable run, pause, and resume recipe actions idempotently", async () => {
    let actionNow = now;
    const { application, database } = createHarness(
      proposalGenerator,
      resolveModelExecution,
      agent,
      () => actionNow,
    );
    const proposal = readyProposal(
      await application.proposeTask("Summarize Hacker News daily", "UTC"),
    );
    const task = await application.createTask(proposal, true);
    const chat = new SqliteChatStore(database.db);
    const session = chat.createSession({ id: "chat-recipe-actions" });
    const message = chat.appendMessage({
      id: "recipe-actions-message",
      sessionId: session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Review these recipe actions." }],
    });
    const assistant = new AiSdkAssistant(database.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock-provider",
        modelId: "mock-model-id",
      }),
    });
    const http = createHttpApp(application, undefined, assistant);

    const recordAction = async (
      id: string,
      action: "run_now" | "pause" | "resume",
    ) => {
      const outcome = await application.proposeTaskAction(task.id, action);
      expect(outcome.status).toBe("ready");
      if (outcome.status !== "ready") {
        throw new Error(`Expected ${action} proposal`);
      }
      return chat.recordWorkflow({
        id,
        sessionId: session.id,
        sourceMessageId: message.id,
        sourceToolCallId: `${id}-tool-call`,
        kind: "task_action",
        payload: JSON.parse(JSON.stringify(outcome)),
      });
    };

    const pause = await recordAction("pause-workflow", "pause");
    const pausePath = `/api/chats/${session.id}/workflows/${pause.id}/accept-task-action`;
    const paused = await http.request(pausePath, { method: "POST" });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({
      action: "pause",
      task: { id: task.id, enabled: false },
    });
    const repeatedPause = await http.request(pausePath, { method: "POST" });
    expect(await repeatedPause.json()).toMatchObject({
      action: "pause",
      task: { id: task.id, enabled: false },
    });

    const resume = await recordAction("resume-workflow", "resume");
    const resumed = await http.request(
      `/api/chats/${session.id}/workflows/${resume.id}/accept-task-action`,
      { method: "POST" },
    );
    expect(await resumed.json()).toMatchObject({
      action: "resume",
      task: { id: task.id, enabled: true },
    });

    const staleRun = await recordAction("stale-run-workflow", "run_now");
    actionNow = new Date(now.getTime() + 1_000);
    await application.updateTask(task.id, { tag: "news" });
    const staleResponse = await http.request(
      `/api/chats/${session.id}/workflows/${staleRun.id}/accept-task-action`,
      { method: "POST" },
    );
    expect(staleResponse.status).toBe(400);
    expect(await staleResponse.json()).toMatchObject({
      error: expect.stringContaining("changed after the action was proposed"),
    });

    const run = await recordAction("run-workflow", "run_now");
    const runPath = `/api/chats/${session.id}/workflows/${run.id}/accept-task-action`;
    const started = await http.request(runPath, { method: "POST" });
    expect(started.status).toBe(202);
    const startedBody = (await started.json()) as {
      action: string;
      run: { id: string };
    };
    expect(startedBody.action).toBe("run_now");
    const repeatedRun = await http.request(runPath, { method: "POST" });
    expect(await repeatedRun.json()).toEqual(startedBody);
    expect(await application.listRuns()).toHaveLength(1);
    expect(assistant.getSession(session.id)?.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: pause.id,
          status: "completed",
          subjectKind: "task",
          subjectId: task.id,
        }),
        expect.objectContaining({
          id: resume.id,
          status: "completed",
          subjectKind: "task",
          subjectId: task.id,
        }),
        expect.objectContaining({
          id: staleRun.id,
          status: "waiting_for_user",
          subjectKind: null,
        }),
        expect.objectContaining({
          id: run.id,
          status: "completed",
          subjectKind: "run",
          subjectId: startedBody.run.id,
        }),
      ]),
    );
    expect(assistant.getSession(session.id)?.session.context).toMatchObject({
      intent: "run.diagnose",
      subjects: [{ kind: "run", id: startedBody.run.id }],
    });
  });
});
