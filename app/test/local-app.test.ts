import { afterEach, describe, expect, test } from "bun:test";
import {
  type AgentRunner,
  type CredentialStore,
  createMarkdownRunResult,
  OpenRouterModelConnection,
  openLocalDatabase,
} from "@shrimp-roll/kernel";
import { LocalApplication } from "../src/server/application.ts";
import { createHttpApp } from "../src/server/http-app.ts";
import type { TaskProposalGenerator } from "../src/server/proposal-generator.ts";
import {
  hackerNewsConnectionId,
  openRouterCredentialRef,
  webConnectionId,
} from "../src/server/sources.ts";

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

const databases: ReturnType<typeof openLocalDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function createHarness(
  selectedProposalGenerator: TaskProposalGenerator = proposalGenerator,
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
    agent,
    proposalGenerator: selectedProposalGenerator,
    now: () => now,
  });
  application.ensureBuiltinConnections();

  return { application, credentials };
}

describe("local product application", () => {
  test("proposes, saves, runs, and reads a task through the shared kernel", async () => {
    const { application } = createHarness();

    const proposal = await application.proposeTask(
      "Summarize Hacker News every morning",
      "UTC",
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

    const run = await application.runTaskNow(task.id);
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
    const proposal = await proposed.json();

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

    const run = await http.request(`/api/tasks/${task.id}/run`, {
      method: "POST",
    });
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({
      status: "succeeded",
      taskName: "Morning HN digest",
    });
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
        };
      },
    };
    const { application } = createHarness(webProposalGenerator);

    const proposal = await application.proposeTask(
      "Check Google Trends daily and produce a cited report on the most searched and fastest-rising topics.",
      "America/Los_Angeles",
    );

    expect(proposal).toMatchObject({
      title: "Daily search-trends report",
      connectionName: "Web",
      toolNames: ["search_web", "fetch_public_url"],
      tools: [
        { name: "search_web", effect: "read" },
        { name: "fetch_public_url", effect: "read" },
      ],
    });
    const task = await application.createTask(proposal, false);
    expect(task.connectionNames).toEqual(["Web"]);
  });
});
