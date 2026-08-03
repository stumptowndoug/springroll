import { afterEach, describe, expect, test } from "bun:test";
import {
  type AgentRunner,
  type ConnectorManifest,
  type CredentialStore,
  connections as connectionTable,
  createMarkdownRunResult,
  type FetchApi,
  integrationManifests,
  OpenRouterModelConnection,
  openLocalDatabase,
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
} from "@springroll/kernel";
import {
  LocalApplication,
  type ResolveModelExecution,
} from "../src/server/application.ts";
import { createHttpApp } from "../src/server/http-app.ts";
import { chooseModelExecution } from "../src/server/model-selection.ts";
import type { TaskProposalGenerator } from "../src/server/proposal-generator.ts";
import {
  exaCredentialRef,
  hackerNewsConnectionId,
  openRouterCredentialRef,
  webConnectionId,
} from "../src/server/sources.ts";
import type { TaskProposalDto, TaskProposalOutcomeDto } from "../src/shared.ts";

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
    expect(request.tools.map((tool) => tool.descriptor.name)).toEqual([
      "get_hacker_news_top_stories",
    ]);
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
    now: selectedNow,
    fetch: selectedFetch,
  });
  application.ensureBuiltinConnections();

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

  test("serves the product API and stores OpenRouter keys outside SQLite", async () => {
    const { application, credentials } = createHarness();
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

    const deletedRun = await http.request(`/api/runs/${runBody.id}`, {
      method: "DELETE",
    });
    expect(deletedRun.status).toBe(204);
    expect((await http.request(`/api/runs/${runBody.id}`)).status).toBe(404);
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

  test("renders persisted and registry manifests and resolves OpenAPI by transport", async () => {
    const manifest: ConnectorManifest = {
      id: "inventory",
      name: "Inventory",
      blurb: "<b>Stock</b> — inspect current inventory.",
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

  test("probes a generic connector before saving its key and connection", async () => {
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
    const http = createHttpApp(application);

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
      probe: "passed",
      toolNames: ["listItems"],
    });

    expect(
      (await http.request("/api/connectors/warehouse", { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect(credentials.values.has("connector-warehouse-default")).toBe(false);
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === "warehouse",
      )?.status,
    ).toBe("not_connected");
  });

  test("starts standard MCP OAuth with dynamic registration and rejects a bad callback state", async () => {
    const manifest: ConnectorManifest = {
      id: "oauth-fixture",
      name: "OAuth Fixture",
      blurb: "<b>Test</b> — exercise standard MCP OAuth.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.example.test/mcp",
      },
      credential: { kind: "oauth" },
      probe: { tool: "health", input: {} },
      tools: {
        allow: ["health"],
        risk: { health: { effect: "read" } },
      },
    };
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
        return Response.json({
          client_id: "springroll-dynamic-client",
          redirect_uris: [
            "http://localhost/api/connectors/oauth-fixture/oauth/callback",
          ],
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

    const started = await http.request("/api/connectors/oauth-fixture/oauth", {
      method: "POST",
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
    expect(
      credentials.values.get("connector-oauth-fixture-default"),
    ).not.toContain("undefined");

    const callback = await http.request(
      "/api/connectors/oauth-fixture/oauth/callback?code=test-code&state=wrong-state",
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain("oauthError=");
    expect(
      database.db
        .select()
        .from(connectionTable)
        .all()
        .some((connection) => connection.manifestId === manifest.id),
    ).toBe(false);

    const validState = authorizationUrl.searchParams.get("state");
    expect(validState).toBeTruthy();
    const completed = await http.request(
      `/api/connectors/oauth-fixture/oauth/callback?code=test-code&state=${encodeURIComponent(validState ?? "")}`,
    );
    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toBe(
      "/integrations/connections?oauth=connected",
    );
    expect(
      (await application.listConnections()).find(
        (connection) => connection.id === manifest.id,
      ),
    ).toMatchObject({ status: "connected", toolCount: 1 });
    const persisted = database.db
      .select()
      .from(connectionTable)
      .all()
      .find((connection) => connection.manifestId === manifest.id);
    expect(persisted?.config).toMatchObject({
      probe: "passed",
      toolNames: ["health"],
    });
    expect(JSON.stringify(persisted)).not.toContain("oauth-access-secret");
    expect(credentials.values.get("connector-oauth-fixture-default")).toContain(
      "oauth-access-secret",
    );
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
                "Search the current public web. The agent chooses its search queries and may search more than once before answering.",
            },
            {
              name: "fetch_public_url",
              description:
                "Read a specific public web page or PDF. Use this after web search when the report needs details from a result URL.",
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
            profile: "managed-auto",
            service: "openrouter",
          },
          {
            capability: "web.fetch",
            profile: "managed-auto",
            service: "openrouter",
          },
        ],
      },
    });
    const task = await application.createTask(proposal, false);
    expect(task.connectionNames).toEqual(["Web"]);
  });
});
