import { describe, expect, test } from "bun:test";
import { openLocalDatabase } from "../src/storage/database.ts";
import { modelCalls, runEvents, runs, tasks } from "../src/storage/schema.ts";
import { SqliteSpendQuery } from "../src/storage/sqlite-spend-query.ts";

describe("SqliteSpendQuery", () => {
  test("aggregates chat calls with canonical and legacy scheduled-run usage", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    const now = new Date("2026-08-08T12:00:00.000Z");
    try {
      local.db
        .insert(modelCalls)
        .values({
          id: "chat-call",
          contextKind: "chat",
          contextId: "chat-turn",
          sequence: 0,
          status: "succeeded",
          billing: "metered",
          inputTokens: 100,
          outputTokens: 20,
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
        })
        .run();
      local.db
        .insert(tasks)
        .values([
          {
            id: "canonical-task",
            prompt: "Canonical run",
            schedule: "0 8 * * *",
            nextRunAt: now,
          },
          {
            id: "legacy-task",
            prompt: "Legacy run",
            schedule: "0 9 * * *",
            nextRunAt: now,
          },
        ])
        .run();
      local.db
        .insert(runs)
        .values([
          {
            id: "canonical-run",
            taskId: "canonical-task",
            scheduledTime: now,
            status: "succeeded",
            executionLocation: "local",
            inputTokens: 40,
            outputTokens: 5,
            totalTokens: 45,
            costUsdMicros: 20,
            estimatedCostUsdMicros: 20,
            createdAt: now,
          },
          {
            id: "legacy-run",
            taskId: "legacy-task",
            scheduledTime: now,
            status: "failed",
            executionLocation: "local",
            inputTokens: 7,
            totalTokens: 7,
            costUsdMicros: 3,
            estimatedCostUsdMicros: 3,
            createdAt: now,
          },
        ])
        .run();
      local.db
        .insert(runEvents)
        .values([
          {
            id: "turn-started",
            runId: "canonical-run",
            sequence: 0,
            type: "model_turn",
            payload: {
              turnId: "canonical-turn",
              phase: "started",
            },
            createdAt: now,
          },
          {
            id: "turn-completed",
            runId: "canonical-run",
            sequence: 1,
            type: "model_turn",
            payload: {
              turnId: "canonical-turn",
              phase: "completed",
            },
            createdAt: now,
          },
          {
            id: "turn-usage",
            runId: "canonical-run",
            sequence: 2,
            type: "usage",
            payload: {
              inputTokens: 40,
              outputTokens: 5,
              totalTokens: 45,
              costUsdMicros: 20,
              estimatedCostUsdMicros: 20,
              providerToolCalls: 1,
            },
            createdAt: now,
          },
        ])
        .run();

      const spend = new SqliteSpendQuery(local.db);
      expect(spend.summary()).toEqual({
        calls: {
          total: 3,
          started: 0,
          succeeded: 2,
          failed: 1,
          cancelled: 0,
        },
        tokens: {
          input: 147,
          output: 25,
          reasoning: 0,
          cachedInput: 0,
          total: 172,
        },
        costUsdMicros: { recorded: 73, actual: 50, estimated: 68 },
        webSearchRequests: 1,
        providerToolCalls: 3,
      });
      expect(spend.summary("run")).toEqual({
        contextKind: "run",
        calls: {
          total: 2,
          started: 0,
          succeeded: 1,
          failed: 1,
          cancelled: 0,
        },
        tokens: {
          input: 47,
          output: 5,
          reasoning: 0,
          cachedInput: 0,
          total: 52,
        },
        costUsdMicros: { recorded: 23, actual: 0, estimated: 23 },
        webSearchRequests: 0,
        providerToolCalls: 1,
      });
    } finally {
      local.close();
    }
  });
});
