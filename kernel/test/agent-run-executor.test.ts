import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { asc, eq } from "drizzle-orm";
import { AiSdkAgentRunner } from "../src/ai-sdk-agent-runner.ts";
import { createHackerNewsToolSource } from "../src/connectors/hacker-news.ts";
import { HttpStatusError } from "../src/failures.ts";
import { AgentRunExecutor } from "../src/storage/agent-run-executor.ts";
import { CronScheduleEngine } from "../src/storage/cron-schedule-engine.ts";
import {
  type LocalDatabase,
  openLocalDatabase,
} from "../src/storage/database.ts";
import {
  connections,
  runEvents,
  runs,
  tasks,
  taskTools,
} from "../src/storage/schema.ts";
import { SqliteTickStore } from "../src/storage/sqlite-tick-store.ts";
import { tick } from "../src/tick.ts";
import { hashToolSchema } from "../src/tools.ts";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function openTemporaryDatabase(): Promise<LocalDatabase> {
  const directory = await mkdtemp(join(tmpdir(), "shrimp-roll-agent-"));
  const database = openLocalDatabase({
    filename: join(directory, "agent-runs.db"),
  });

  cleanup.push(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  return database;
}

const usage = {
  inputTokens: {
    total: 12,
    noCache: 12,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 8,
    text: 8,
    reasoning: 0,
  },
};

describe("AgentRunExecutor", () => {
  test("persists a scheduled tool run, transcript, usage, and cost", async () => {
    const database = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    const tickTime = new Date("2026-07-31T15:00:30.000Z");
    const agentStartedAt = new Date("2026-07-31T15:00:31.000Z");
    const agentFinishedAt = new Date("2026-07-31T15:00:32.000Z");
    const source = createHackerNewsToolSource({
      fetch: async (input) => {
        const url = String(input);

        if (url.endsWith("/topstories.json")) {
          return Response.json([101]);
        }

        if (url.endsWith("/item/101.json")) {
          return Response.json({
            id: 101,
            type: "story",
            title: "Local-first software",
            score: 120,
          });
        }

        return new Response(null, { status: 404 });
      },
    });
    const sourceSession = await source.open({
      connection: {
        id: "connection-hn",
        sourceId: source.id,
        credentialRef: "none",
        availableIn: ["local"],
      },
      location: "local",
    });
    const [descriptor] = await sourceSession.listTools();
    await sourceSession.close();

    if (!descriptor) {
      throw new Error("Hacker News tool is missing");
    }

    database.db
      .insert(tasks)
      .values({
        id: "task-hn",
        prompt: "Summarize Hacker News every morning",
        schedule: "0 15 * * *",
        scheduleTimezone: "UTC",
        catchUpPolicy: "catch_up",
        nextRunAt: scheduledTime,
      })
      .run();
    database.db
      .insert(connections)
      .values({
        id: "connection-hn",
        sourceId: source.id,
        credentialRef: "none",
        availableIn: ["local"],
      })
      .run();
    database.db
      .insert(taskTools)
      .values({
        taskId: "task-hn",
        connectionId: "connection-hn",
        sourceId: source.id,
        name: descriptor.name,
        inputSchemaHash: await hashToolSchema(descriptor.inputSchema),
        riskEffect: "read",
        riskOpenWorld: true,
        riskIdempotent: true,
        approval: "never",
      })
      .run();

    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-call-1",
              toolName: descriptor.name,
              input: '{"limit":1}',
              dynamic: true,
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage,
          warnings: [],
        },
        {
          content: [
            {
              type: "text",
              text: "Local-first software led Hacker News today.",
            },
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    let firstClockRead = true;
    const agent = new AiSdkAgentRunner(model, {
      now: () => {
        if (firstClockRead) {
          firstClockRead = false;
          return agentStartedAt;
        }

        return agentFinishedAt;
      },
      pricing: {
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 8,
      },
    });

    expect(
      await tick(
        {
          store: new SqliteTickStore(database.db),
          schedule: new CronScheduleEngine(database.db),
          executor: new AgentRunExecutor(database.db, {
            agent,
            getToolSource: (sourceId) =>
              sourceId === source.id ? source : undefined,
            now: () => tickTime,
          }),
        },
        tickTime,
      ),
    ).toEqual({ due: 1, claimed: 1, duplicate: 0 });

    const [storedRun] = database.db.select().from(runs).all();
    if (!storedRun) {
      throw new Error("Expected the scheduled run to be persisted");
    }
    const storedEvents = database.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, storedRun.id))
      .orderBy(asc(runEvents.sequence))
      .all();

    expect(storedRun).toMatchObject({
      status: "succeeded",
      startedAt: agentStartedAt,
      finishedAt: agentFinishedAt,
      durationMs: 1_000,
      transcriptSummary: "Local-first software led Hacker News today.",
      transcriptBody: "Local-first software led Hacker News today.",
      resultJson: {
        schemaVersion: 1,
        disposition: "informational",
        summary: "Local-first software led Hacker News today.",
        body: {
          format: "markdown",
          content: "Local-first software led Hacker News today.",
        },
        sources: [],
        artifacts: [],
        proposals: [],
        notices: [],
      },
      modelProvider: "mock-provider",
      modelId: "mock-model-id",
      inputTokens: 24,
      outputTokens: 16,
      totalTokens: 40,
      costUsdMicros: 176,
      failureCategory: null,
      error: null,
    });
    expect(storedEvents.map((event) => event.type)).toEqual([
      "run_started",
      "lifecycle",
      "policy_decision",
      "tool_call",
      "tool_result",
      "message",
      "usage",
      "usage",
      "lifecycle",
      "agent_output",
      "run_succeeded",
    ]);
    expect(storedEvents[3]?.payload).toMatchObject({
      toolName: descriptor.name,
      input: { limit: 1 },
      effect: "read",
      approval: "never",
    });
    expect(storedEvents[9]?.payload).toEqual({
      result: storedRun.resultJson,
    });
  });

  test("persists agent failures and lets the scheduling tick complete", async () => {
    const database = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    const startedAt = new Date("2026-07-31T15:00:30.000Z");
    const finishedAt = new Date("2026-07-31T15:00:32.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-failing",
        prompt: "A task whose model is unavailable",
        schedule: "0 15 * * *",
        scheduleTimezone: "UTC",
        nextRunAt: scheduledTime,
      })
      .run();
    let firstClockRead = true;

    const result = await tick(
      {
        store: new SqliteTickStore(database.db),
        schedule: new CronScheduleEngine(database.db),
        executor: new AgentRunExecutor(database.db, {
          agent: {
            async run() {
              throw new HttpStatusError(401, "model provider unauthorized");
            },
          },
          getToolSource: () => undefined,
          now: () => {
            if (firstClockRead) {
              firstClockRead = false;
              return startedAt;
            }

            return finishedAt;
          },
        }),
      },
      startedAt,
    );

    const [storedRun] = database.db.select().from(runs).all();
    const storedEvents = database.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, storedRun?.id ?? "missing"))
      .orderBy(asc(runEvents.sequence))
      .all();

    expect(result).toEqual({ due: 1, claimed: 1, duplicate: 0 });
    expect(storedRun).toMatchObject({
      status: "failed",
      startedAt,
      finishedAt,
      durationMs: 2_000,
      failureCategory: "authentication",
      error: "model provider unauthorized",
    });
    expect(storedEvents.map((event) => event.type)).toEqual([
      "run_started",
      "run_failed",
    ]);
    expect(storedEvents[1]?.payload).toEqual({
      category: "authentication",
      error: "model provider unauthorized",
      retryable: false,
    });
  });
});
