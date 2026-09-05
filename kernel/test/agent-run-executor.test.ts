import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { asc, eq } from "drizzle-orm";
import {
  AgentRunApprovalRequiredError,
  AiSdkAgentRunner,
} from "../src/ai-sdk-agent-runner.ts";
import { createHackerNewsToolSource } from "../src/connectors/hacker-news.ts";
import { HttpStatusError } from "../src/failures.ts";
import { claimLocalScheduledOccurrence } from "../src/host/local-task-occurrence.ts";
import { PartialRunFailure } from "../src/partial-run-failure.ts";
import { createMarkdownRunResult } from "../src/run-results.ts";
import { AgentRunExecutor } from "../src/storage/agent-run-executor.ts";
import {
  type LocalDatabase,
  openLocalDatabase,
} from "../src/storage/database.ts";
import {
  connections,
  runCheckpoints,
  runEvents,
  runs,
  tasks,
  taskTools,
  toolApprovals,
} from "../src/storage/schema.ts";
import { SqliteRunCheckpointStore } from "../src/storage/sqlite-run-checkpoint-store.ts";
import { SqliteToolApprovalStore } from "../src/storage/sqlite-tool-approval-store.ts";
import { hashToolSchema, type ToolSource } from "../src/tools.ts";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function openTemporaryDatabase(): Promise<LocalDatabase> {
  const directory = await mkdtemp(join(tmpdir(), "springroll-agent-"));
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
    noCache: 10,
    cacheRead: 2,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 8,
    text: 6,
    reasoning: 2,
  },
};

function plainResponse(reportMarkdown: string, id = "research-output") {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id },
        {
          type: "text-delta" as const,
          id,
          delta: reportMarkdown,
        },
        { type: "text-end" as const, id },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage,
        },
      ],
    }),
  };
}

describe("AgentRunExecutor", () => {
  test("fails an uncheckpointed running run after restart without replaying it", async () => {
    const database = await openTemporaryDatabase();
    const startedAt = new Date("2026-08-08T16:00:00.000Z");
    const restartedAt = new Date("2026-08-08T16:00:12.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-interrupted",
        prompt: "Do not replay ambiguous work",
        schedule: "0 16 * * *",
        scheduleTimezone: "UTC",
        nextRunAt: new Date("2026-08-09T16:00:00.000Z"),
      })
      .run();
    database.db
      .insert(runs)
      .values({
        id: "run-uncheckpointed",
        taskId: "task-interrupted",
        scheduledTime: startedAt,
        status: "running",
        executionLocation: "local",
        startedAt,
      })
      .run();
    database.db
      .insert(runEvents)
      .values({
        id: "event-started",
        runId: "run-uncheckpointed",
        sequence: 0,
        type: "run_started",
        payload: {
          taskId: "task-interrupted",
          scheduledTime: startedAt.toISOString(),
        },
        createdAt: startedAt,
      })
      .run();
    let agentCalls = 0;
    const options = {
      agent: {
        async run() {
          agentCalls += 1;
          throw new Error("Recovered work must not execute");
        },
      },
      getToolSource: () => undefined,
      now: () => restartedAt,
    };

    const executor = new AgentRunExecutor(database.db, options);
    expect(
      database.db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, "run-uncheckpointed"))
        .get(),
    ).toEqual({ status: "running" });
    await executor.recoverInterruptedWork();
    await executor.recoverInterruptedWork();

    expect(
      database.db
        .select()
        .from(runs)
        .where(eq(runs.id, "run-uncheckpointed"))
        .get(),
    ).toMatchObject({
      status: "failed",
      failureCategory: "policy",
      finishedAt: restartedAt,
      durationMs: 12_000,
      error: expect.stringContaining("was not retried"),
    });
    expect(
      database.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, "run-uncheckpointed"))
        .orderBy(asc(runEvents.sequence))
        .all()
        .map((event) => ({ type: event.type, payload: event.payload })),
    ).toEqual([
      {
        type: "run_started",
        payload: {
          taskId: "task-interrupted",
          scheduledTime: startedAt.toISOString(),
        },
      },
      {
        type: "run_failed",
        payload: {
          category: "policy",
          error: expect.stringContaining("external side effect"),
          retryable: false,
        },
      },
    ]);
    expect(agentCalls).toBe(0);
  });

  test("enforces checkpoint privacy through the executor write path", async () => {
    const database = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-08-08T17:00:00.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-private-checkpoint",
        prompt: "Pause without private provider state",
        schedule: "0 17 * * *",
        scheduleTimezone: "UTC",
        nextRunAt: scheduledTime,
      })
      .run();
    database.db
      .insert(runs)
      .values({
        id: "run-private-checkpoint",
        taskId: "task-private-checkpoint",
        scheduledTime,
        status: "claimed",
        executionLocation: "local",
      })
      .run();
    const executor = new AgentRunExecutor(database.db, {
      agent: {
        async run() {
          throw new AgentRunApprovalRequiredError(
            [
              {
                role: "user",
                content: "private continuation",
                providerOptions: { mock: { secret: "do-not-store" } },
              },
            ],
            [],
          );
        },
      },
      getToolSource: () => undefined,
    });

    await expect(
      executor.execute(
        "run-private-checkpoint",
        "task-private-checkpoint",
        scheduledTime,
      ),
    ).rejects.toThrow("must not contain reasoning or provider metadata");
    expect(database.db.select().from(runCheckpoints).all()).toEqual([]);
    expect(
      database.db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, "run-private-checkpoint"))
        .get(),
    ).toEqual({ status: "running" });
  });

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
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tool-call-1",
                toolName: descriptor.name,
                input: '{"limit":1}',
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage,
              },
            ],
          }),
        },
        plainResponse(
          "Local-first software led Hacker News today.",
          "research-1",
        ),
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
      catalogRevision: "catalog-v1",
    });
    const executor = new AgentRunExecutor(database.db, {
      agent,
      getToolSource: (sourceId) =>
        sourceId === source.id ? source : undefined,
      now: () => tickTime,
    });

    const claim = claimLocalScheduledOccurrence(
      database.db,
      "task-hn",
      scheduledTime,
      tickTime,
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Expected a run claim");
    await executor.execute(claim.runId, "task-hn", claim.scheduledTime);

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
      modelBilling: "metered",
      catalogRevision: "catalog-v1",
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 8,
      inputTokens: 24,
      outputTokens: 16,
      cachedInputTokens: 4,
      reasoningTokens: 4,
      totalTokens: 40,
      costUsdMicros: 176,
      actualCostUsdMicros: null,
      estimatedCostUsdMicros: 176,
      costSource: "catalog_estimate",
      failureCategory: null,
      error: null,
    });
    expect(storedEvents.map((event) => event.type)).toEqual([
      "run_started",
      "model_selection",
      "lifecycle",
      "model_turn",
      "model_turn",
      "policy_decision",
      "tool_call",
      "tool_result",
      "usage",
      "model_turn",
      "model_turn",
      "usage",
      "message",
      "lifecycle",
      "agent_output",
      "run_succeeded",
    ]);
    expect(storedEvents[6]?.payload).toMatchObject({
      toolName: descriptor.name,
      input: { limit: 1 },
      effect: "read",
      approval: "never",
    });
    expect(storedEvents[14]?.payload).toEqual({
      result: storedRun.resultJson,
    });
    const modelPrompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(modelPrompt).toContain(
      "Scheduled occurrence: 2026-07-31T15:00:00.000Z",
    );
    expect(modelPrompt).toContain("Task timezone: UTC");

    await executor.execute(storedRun.id, "task-hn", scheduledTime);
    expect(
      database.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, storedRun.id))
        .all(),
    ).toHaveLength(storedEvents.length);
  });

  test("persists agent failures after actor occurrence admission", async () => {
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

    const executor = new AgentRunExecutor(database.db, {
      agent: {
        async run(request) {
          await request.eventSink?.append(
            {
              type: "model_selection",
              provider: "openrouter",
              modelId: "unavailable-model",
              billing: "metered",
              catalogRevision: '"catalog-v1"',
            },
            startedAt,
          );
          await request.eventSink?.append(
            {
              type: "usage",
              modelCallId: "failed-call",
              provider: "openrouter",
              modelId: "unavailable-model",
              billing: "metered",
              inputTokens: 8,
              totalTokens: 8,
              estimatedCostUsdMicros: 6,
              costUsdMicros: 6,
              costSource: "catalog_estimate",
            },
            startedAt,
          );
          throw new PartialRunFailure(
            new HttpStatusError(401, "model provider unauthorized"),
            createMarkdownRunResult({
              body: "## Run incomplete\n\nNo answer was verified.",
              fallbackSummary: "Run incomplete",
              disposition: "needs_attention",
            }),
          );
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
    });
    const claim = claimLocalScheduledOccurrence(
      database.db,
      "task-failing",
      scheduledTime,
      startedAt,
    );
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Expected a run claim");
    await executor.execute(claim.runId, "task-failing", claim.scheduledTime);

    const [storedRun] = database.db.select().from(runs).all();
    const storedEvents = database.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, storedRun?.id ?? "missing"))
      .orderBy(asc(runEvents.sequence))
      .all();

    expect(storedRun).toMatchObject({
      status: "failed",
      startedAt,
      finishedAt,
      durationMs: 2_000,
      modelProvider: "openrouter",
      modelId: "unavailable-model",
      catalogRevision: '"catalog-v1"',
      inputTokens: 8,
      totalTokens: 8,
      costUsdMicros: 6,
      estimatedCostUsdMicros: 6,
      costSource: "catalog_estimate",
      failureCategory: "authentication",
      error: "model provider unauthorized",
      transcriptBody: "## Run incomplete\n\nNo answer was verified.",
      resultJson: { disposition: "needs_attention" },
    });
    expect(storedEvents.map((event) => event.type)).toEqual([
      "run_started",
      "model_selection",
      "usage",
      "run_failed",
    ]);
    expect(storedEvents[3]?.payload).toEqual({
      category: "authentication",
      error: "model provider unauthorized",
      retryable: false,
    });
  });

  test("enforces connector check-first and off policies in the host", async () => {
    const database = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-08-06T14:00:00.000Z");
    const descriptors = [
      {
        name: "publish_digest",
        description: "Publish the prepared digest.",
        inputSchema: { type: "object", properties: {} },
        declaredRisk: {
          effect: "write" as const,
          openWorld: true,
          idempotent: false,
        },
      },
      {
        name: "read_private_draft",
        description: "Read a private draft.",
        inputSchema: { type: "object", properties: {} },
        declaredRisk: {
          effect: "read" as const,
          openWorld: true,
          idempotent: true,
        },
      },
    ];
    const source: ToolSource = {
      id: "test.capability-settings",
      kind: "native",
      async open() {
        return {
          async listTools() {
            return descriptors;
          },
          async callTool() {
            throw new Error("The fixture agent does not call tools");
          },
          async close() {},
        };
      },
    };
    database.db
      .insert(tasks)
      .values({
        id: "task-capability-settings",
        prompt: "Prepare the daily digest",
        schedule: "0 14 * * *",
        scheduleTimezone: "UTC",
        nextRunAt: scheduledTime,
      })
      .run();
    database.db
      .insert(connections)
      .values({
        id: "connection-capability-settings",
        sourceId: source.id,
        credentialRef: "none",
        config: {
          toolPolicies: {
            publish_digest: "check_first",
            read_private_draft: "off",
          },
        },
        availableIn: ["local"],
      })
      .run();
    database.db
      .insert(taskTools)
      .values(
        await Promise.all(
          descriptors.map(async (descriptor) => ({
            taskId: "task-capability-settings",
            connectionId: "connection-capability-settings",
            sourceId: source.id,
            name: descriptor.name,
            inputSchemaHash: await hashToolSchema(descriptor.inputSchema),
            riskEffect: descriptor.declaredRisk.effect,
            riskOpenWorld: descriptor.declaredRisk.openWorld,
            riskIdempotent: descriptor.declaredRisk.idempotent,
            approval: "never" as const,
          })),
        ),
      )
      .run();
    database.db
      .insert(runs)
      .values({
        id: "run-capability-settings",
        taskId: "task-capability-settings",
        scheduledTime,
        status: "claimed",
        executionLocation: "local",
      })
      .run();

    await new AgentRunExecutor(database.db, {
      agent: {
        async run(request) {
          expect(request.task.tools).toMatchObject([
            { name: "publish_digest", approval: "before_call" },
          ]);
          expect(
            request.tools.map(({ descriptor }) => descriptor.name),
          ).toEqual(["publish_digest", "update_task_notes"]);
          return {
            result: createMarkdownRunResult({
              body: "The digest is ready.",
              fallbackSummary: "Digest ready.",
            }),
            toolCalls: [],
            usage: {},
            startedAt: scheduledTime,
            finishedAt: scheduledTime,
          };
        },
      },
      getToolSource: (sourceId) =>
        sourceId === source.id ? source : undefined,
    }).execute(
      "run-capability-settings",
      "task-capability-settings",
      scheduledTime,
    );

    expect(
      database.db
        .select()
        .from(runs)
        .where(eq(runs.id, "run-capability-settings"))
        .get(),
    ).toMatchObject({ status: "succeeded" });
  });

  test("persists a destructive approval checkpoint and resumes it after restart", async () => {
    const database = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-08-06T15:00:00.000Z");
    const descriptor = {
      name: "publish_digest",
      description: "Publish the prepared digest.",
      inputSchema: {
        type: "object",
        properties: { channel: { type: "string" } },
        required: ["channel"],
        additionalProperties: false,
      },
      declaredRisk: {
        effect: "destructive" as const,
        openWorld: true,
        idempotent: false,
      },
    };
    const calls: unknown[] = [];
    const source: ToolSource = {
      id: "test.publisher",
      kind: "native",
      async open() {
        return {
          async listTools() {
            return [descriptor];
          },
          async callTool(name, input) {
            if (name !== descriptor.name) throw new Error("Unknown tool");
            calls.push(input);
            return { content: ["published"] };
          },
          async close() {},
        };
      },
    };
    database.db
      .insert(tasks)
      .values({
        id: "task-approval",
        prompt: "Publish the daily digest",
        schedule: "0 15 * * *",
        scheduleTimezone: "UTC",
        nextRunAt: scheduledTime,
      })
      .run();
    database.db
      .insert(connections)
      .values({
        id: "connection-publisher",
        sourceId: source.id,
        credentialRef: "none",
        availableIn: ["local"],
        config: { toolPolicies: { publish_digest: "check_first" } },
      })
      .run();
    database.db
      .insert(taskTools)
      .values({
        taskId: "task-approval",
        connectionId: "connection-publisher",
        sourceId: source.id,
        name: descriptor.name,
        inputSchemaHash: await hashToolSchema(descriptor.inputSchema),
        riskEffect: "destructive",
        riskOpenWorld: true,
        riskIdempotent: false,
        approval: "never",
      })
      .run();
    database.db
      .insert(runs)
      .values({
        id: "run-approval",
        taskId: "task-approval",
        scheduledTime,
        status: "claimed",
        executionLocation: "local",
      })
      .run();
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "publish-1",
                toolName: descriptor.name,
                input: '{"channel":"daily"}',
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage,
              },
            ],
          }),
        },
        plainResponse("The daily digest was published.", "research-published"),
      ],
    });
    const options = {
      agent: new AiSdkAgentRunner(model),
      getToolSource: (sourceId: string) =>
        sourceId === source.id ? source : undefined,
    };

    await new AgentRunExecutor(database.db, options).execute(
      "run-approval",
      "task-approval",
      scheduledTime,
    );

    expect(
      database.db.select().from(runs).where(eq(runs.id, "run-approval")).get(),
    ).toMatchObject({ status: "waiting_for_approval", finishedAt: null });
    expect(database.db.select().from(runCheckpoints).all()).toHaveLength(1);
    const approval = database.db.select().from(toolApprovals).get();
    expect(approval).toMatchObject({
      contextKind: "run",
      contextId: "run-approval",
      toolCallId: "publish-1",
      toolName: descriptor.name,
      input: { channel: "daily" },
      riskEffect: "destructive",
      status: "pending",
    });
    expect(calls).toEqual([]);
    if (!approval) throw new Error("Expected a pending approval");

    const resumedExecutor = new AgentRunExecutor(database.db, options);
    const decisions = [{ id: approval.id, approved: true }] as const;
    resumedExecutor.validateResume("run-approval", decisions);
    expect(
      database.db.select().from(runs).where(eq(runs.id, "run-approval")).get(),
    ).toMatchObject({ status: "waiting_for_approval" });
    expect(database.db.select().from(toolApprovals).get()).toMatchObject({
      status: "pending",
    });
    await resumedExecutor.resume("run-approval", decisions);

    expect(
      database.db.select().from(runs).where(eq(runs.id, "run-approval")).get(),
    ).toMatchObject({
      status: "succeeded",
      transcriptBody: "The daily digest was published.",
      error: null,
    });
    expect(database.db.select().from(runCheckpoints).all()).toEqual([]);
    expect(database.db.select().from(toolApprovals).get()).toMatchObject({
      status: "succeeded",
      outcome: { state: "output-available" },
    });
    expect(calls).toEqual([{ channel: "daily" }]);
    expect(
      database.db
        .select({ type: runEvents.type, payload: runEvents.payload })
        .from(runEvents)
        .where(eq(runEvents.runId, "run-approval"))
        .all()
        .filter(
          (event) =>
            event.type === "model_turn" && event.payload.phase === "completed",
        )
        .map((event) => event.payload.step),
    ).toEqual([0, 1]);

    database.db
      .insert(runs)
      .values({
        id: "run-interrupted",
        taskId: "task-approval",
        scheduledTime: new Date("2026-08-06T17:00:00.000Z"),
        status: "running",
        executionLocation: "local",
        startedAt: scheduledTime,
      })
      .run();
    const interruptedApprovalId = "approval-interrupted";
    new SqliteRunCheckpointStore(database.db).save("run-interrupted", [
      { role: "user", content: "Publish the daily digest" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "publish-interrupted",
            toolName: descriptor.name,
            input: { channel: "restart" },
          },
          {
            type: "tool-approval-request",
            approvalId: interruptedApprovalId,
            toolCallId: "publish-interrupted",
          },
        ],
      },
    ]);
    const interruptedApprovals = new SqliteToolApprovalStore(database.db);
    interruptedApprovals.recordPending({
      id: interruptedApprovalId,
      contextKind: "run",
      contextId: "run-interrupted",
      toolCallId: "publish-interrupted",
      toolName: descriptor.name,
      input: { channel: "restart" },
      riskEffect: "write",
    });
    interruptedApprovals.decide("run", "run-interrupted", [
      { id: interruptedApprovalId, approved: true },
    ]);
    interruptedApprovals.markExecuting(interruptedApprovalId);

    await new AgentRunExecutor(database.db, options).recoverInterruptedWork();

    expect(
      database.db
        .select()
        .from(runs)
        .where(eq(runs.id, "run-interrupted"))
        .get(),
    ).toMatchObject({
      status: "failed",
      failureCategory: "policy",
      error: expect.stringContaining("Verify remote state"),
    });
    expect(interruptedApprovals.get(interruptedApprovalId)).toMatchObject({
      status: "interrupted",
      outcome: { state: "ambiguous" },
    });
    expect(
      database.db
        .select()
        .from(runCheckpoints)
        .where(eq(runCheckpoints.runId, "run-interrupted"))
        .all(),
    ).toEqual([]);

    database.db
      .insert(runs)
      .values({
        id: "run-denied",
        taskId: "task-approval",
        scheduledTime: new Date("2026-08-06T16:00:00.000Z"),
        status: "claimed",
        executionLocation: "local",
      })
      .run();
    const denialModel = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "publish-denied",
                toolName: descriptor.name,
                input: '{"channel":"private"}',
                dynamic: true,
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage,
              },
            ],
          }),
        },
        plainResponse("The digest was not published.", "research-denied"),
      ],
    });
    const denialExecutor = new AgentRunExecutor(database.db, {
      ...options,
      agent: new AiSdkAgentRunner(denialModel),
    });
    await denialExecutor.execute(
      "run-denied",
      "task-approval",
      new Date("2026-08-06T16:00:00.000Z"),
    );
    const deniedApproval = database.db
      .select()
      .from(toolApprovals)
      .where(eq(toolApprovals.contextId, "run-denied"))
      .get();
    if (!deniedApproval) throw new Error("Expected a denied run approval");
    await denialExecutor.resume("run-denied", [
      {
        id: deniedApproval.id,
        approved: false,
        reason: "Keep it private",
      },
    ]);
    expect(
      database.db.select().from(runs).where(eq(runs.id, "run-denied")).get(),
    ).toMatchObject({
      status: "succeeded",
      transcriptBody: "The digest was not published.",
    });
    expect(
      database.db
        .select()
        .from(toolApprovals)
        .where(eq(toolApprovals.contextId, "run-denied"))
        .get(),
    ).toMatchObject({ status: "denied", reason: "Keep it private" });
    expect(calls).toEqual([{ channel: "daily" }]);
  });

  test("stops a claimed run before it starts", async () => {
    const database = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-08-17T16:00:00.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-stop-claimed",
        prompt: "Stop before start",
        schedule: "0 16 * * *",
        scheduleTimezone: "UTC",
        nextRunAt: scheduledTime,
      })
      .run();
    database.db
      .insert(runs)
      .values({
        id: "run-stop-claimed",
        taskId: "task-stop-claimed",
        scheduledTime,
        status: "claimed",
        executionLocation: "local",
      })
      .run();
    const executor = new AgentRunExecutor(database.db, {
      agent: {
        async run() {
          throw new Error("stopped runs must not start");
        },
      },
      getToolSource: () => undefined,
    });

    expect(executor.cancel("run-stop-claimed")).toBe(true);
    expect(
      database.db
        .select()
        .from(runs)
        .where(eq(runs.id, "run-stop-claimed"))
        .get(),
    ).toMatchObject({
      status: "failed",
      error: "Stopped",
      failureCategory: "policy",
    });

    await executor.execute(
      "run-stop-claimed",
      "task-stop-claimed",
      scheduledTime,
    );
    expect(
      database.db
        .select()
        .from(runs)
        .where(eq(runs.id, "run-stop-claimed"))
        .get(),
    ).toMatchObject({
      status: "failed",
      error: "Stopped",
    });
    expect(executor.cancel("run-stop-claimed")).toBe(false);
  });

  test("aborts an in-flight run and persists Stopped", async () => {
    const database = await openTemporaryDatabase();
    const scheduledTime = new Date("2026-08-17T17:00:00.000Z");
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    database.db
      .insert(tasks)
      .values({
        id: "task-stop-running",
        prompt: "Stop while running",
        schedule: "0 17 * * *",
        scheduleTimezone: "UTC",
        nextRunAt: scheduledTime,
      })
      .run();
    database.db
      .insert(runs)
      .values({
        id: "run-stop-running",
        taskId: "task-stop-running",
        scheduledTime,
        status: "claimed",
        executionLocation: "local",
      })
      .run();
    const executor = new AgentRunExecutor(database.db, {
      agent: {
        async run(request) {
          started();
          return await new Promise<never>((_, reject) => {
            const signal = request.signal;
            if (!signal) {
              reject(new Error("Expected an abort signal"));
              return;
            }
            if (signal.aborted) {
              reject(
                signal.reason ?? new DOMException("Aborted", "AbortError"),
              );
              return;
            }
            signal.addEventListener("abort", () => {
              reject(
                signal.reason ?? new DOMException("Aborted", "AbortError"),
              );
            });
          });
        },
      },
      getToolSource: () => undefined,
    });

    const executing = executor.execute(
      "run-stop-running",
      "task-stop-running",
      scheduledTime,
    );
    await startedPromise;
    expect(executor.cancel("run-stop-running")).toBe(true);
    await executing;
    expect(
      database.db
        .select()
        .from(runs)
        .where(eq(runs.id, "run-stop-running"))
        .get(),
    ).toMatchObject({
      status: "failed",
      error: "Stopped",
      failureCategory: "policy",
    });
    expect(executor.cancel("run-stop-running")).toBe(false);
  });
});
