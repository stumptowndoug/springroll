import { afterEach, describe, expect, test } from "bun:test";
import {
  type AgentRunner,
  type CredentialStore,
  OpenRouterModelConnection,
  openLocalDatabase,
} from "@shrimp-roll/kernel";
import { LocalApplication } from "../src/server/application.ts";
import { createHttpApp } from "../src/server/http-app.ts";
import type { TaskProposalGenerator } from "../src/server/proposal-generator.ts";
import {
  hackerNewsConnectionId,
  openRouterCredentialRef,
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
      transcript: {
        summary: "AI and local-first software led Hacker News.",
        body: "I read the top Hacker News stories. AI and local-first software led the discussion.",
      },
      toolCalls: [],
      usage: {
        provider: "openrouter",
        modelId: "test-model",
        totalTokens: 42,
        costUsdMicros: 120,
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

function createHarness() {
  const database = openLocalDatabase({ filename: ":memory:" });
  databases.push(database);
  const credentials = new MemoryCredentialStore();
  const models = new OpenRouterModelConnection(credentials, {
    fetch: async () => Response.json({ data: { label: "test-key" } }),
  });
  const application = new LocalApplication(database.db, {
    credentials,
    models,
    agent,
    proposalGenerator,
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
      toolCalls: 0,
      durationMs: 1_000,
      costUsdMicros: 120,
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
});
