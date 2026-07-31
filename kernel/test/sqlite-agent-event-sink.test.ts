import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { openLocalDatabase } from "../src/storage/database.ts";
import { runEvents, runs, tasks } from "../src/storage/schema.ts";
import { SqliteAgentEventSink } from "../src/storage/sqlite-agent-event-sink.ts";

const databases: ReturnType<typeof openLocalDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("SqliteAgentEventSink", () => {
  test("appends canonical events after existing run lifecycle rows", async () => {
    const database = openLocalDatabase({ filename: ":memory:" });
    databases.push(database);
    const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
    database.db
      .insert(tasks)
      .values({
        id: "task-events",
        prompt: "Summarize the daily signal",
        schedule: "0 15 * * *",
        scheduleTimezone: "UTC",
        catchUpPolicy: "catch_up",
        nextRunAt: scheduledTime,
      })
      .run();
    database.db
      .insert(runs)
      .values({
        id: "run-events",
        taskId: "task-events",
        scheduledTime,
        status: "running",
        executionLocation: "local",
      })
      .run();
    database.db
      .insert(runEvents)
      .values({
        id: "legacy-start",
        runId: "run-events",
        sequence: 0,
        type: "run_started",
        payload: {},
        createdAt: scheduledTime,
      })
      .run();

    const sink = new SqliteAgentEventSink(database.db, "run-events");
    const event = await sink.append(
      { type: "lifecycle", phase: "started" },
      new Date("2026-07-31T15:00:01.000Z"),
    );
    await sink.append(
      {
        type: "model_selection",
        provider: "openrouter",
        modelId: "openai/useful",
        billing: "metered",
        catalogRevision: '"catalog-v1"',
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 4,
      },
      new Date("2026-07-31T15:00:01.500Z"),
    );
    await sink.append(
      {
        type: "usage",
        modelCallId: "model-call-1",
        provider: "openrouter",
        modelId: "openai/useful",
        billing: "metered",
        inputTokens: 30,
        outputTokens: 12,
        cachedInputTokens: 5,
        reasoningTokens: 3,
        totalTokens: 42,
        costUsdMicros: 100,
        actualCostUsdMicros: 100,
        estimatedCostUsdMicros: 78,
        costSource: "provider_reported",
        webSearchRequests: 1,
      },
      new Date("2026-07-31T15:00:02.000Z"),
    );
    await sink.append(
      {
        type: "usage",
        modelCallId: "model-call-2",
        provider: "openrouter",
        modelId: "openai/useful",
        billing: "metered",
        inputTokens: 20,
        outputTokens: 8,
        cachedInputTokens: 2,
        reasoningTokens: 1,
        totalTokens: 28,
        costUsdMicros: 70,
        actualCostUsdMicros: 70,
        estimatedCostUsdMicros: 52,
        costSource: "provider_reported",
      },
      new Date("2026-07-31T15:00:03.000Z"),
    );

    expect(event).toMatchObject({
      schemaVersion: 1,
      runId: "run-events",
      sequence: 1,
      type: "lifecycle",
      phase: "started",
    });
    expect(
      database.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, "run-events"))
        .all()
        .map((row) => ({
          sequence: row.sequence,
          type: row.type,
          schemaVersion: row.payload.schemaVersion,
        })),
    ).toEqual([
      { sequence: 0, type: "run_started", schemaVersion: undefined },
      { sequence: 1, type: "lifecycle", schemaVersion: 1 },
      { sequence: 2, type: "model_selection", schemaVersion: 1 },
      { sequence: 3, type: "usage", schemaVersion: 1 },
      { sequence: 4, type: "usage", schemaVersion: 1 },
    ]);
    expect(
      database.db.select().from(runs).where(eq(runs.id, "run-events")).get(),
    ).toMatchObject({
      modelProvider: "openrouter",
      modelId: "openai/useful",
      modelBilling: "metered",
      catalogRevision: '"catalog-v1"',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 4,
      inputTokens: 50,
      outputTokens: 20,
      cachedInputTokens: 7,
      reasoningTokens: 4,
      totalTokens: 70,
      actualCostUsdMicros: 170,
      estimatedCostUsdMicros: 130,
      costUsdMicros: 170,
      costSource: "provider_reported",
      webSearchRequests: 1,
    });
  });
});
