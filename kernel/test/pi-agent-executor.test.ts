import { describe, expect, test } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { eq } from "drizzle-orm";
import { PiAgentRunner } from "../src/pi-agent-runner.ts";
import { AgentRunExecutor } from "../src/storage/agent-run-executor.ts";
import { openLocalDatabase } from "../src/storage/database.ts";
import { runEvents, runs, tasks } from "../src/storage/schema.ts";

describe("PiAgentRunner persistence", () => {
  test("persists step events before materializing the successful run", async () => {
    const database = openLocalDatabase({ filename: ":memory:" });
    try {
      const scheduledTime = new Date("2026-07-31T15:00:00.000Z");
      database.db
        .insert(tasks)
        .values({
          id: "task-pi-persisted",
          name: "Pi persisted task",
          prompt: "Summarize the daily signal.",
          schedule: "0 15 * * *",
          scheduleTimezone: "UTC",
          catchUpPolicy: "catch_up",
          nextRunAt: scheduledTime,
        })
        .run();
      database.db
        .insert(runs)
        .values({
          id: "run-pi-persisted",
          taskId: "task-pi-persisted",
          scheduledTime,
          status: "claimed",
          executionLocation: "local",
        })
        .run();

      const faux = fauxProvider({
        provider: "test-provider",
        models: [{ id: "test-model" }],
      });
      faux.setResponses([
        fauxAssistantMessage("The daily signal remained stable.", {
          stopReason: "stop",
          responseId: "response-persisted",
        }),
      ]);
      const models = createModels();
      models.setProvider(faux.provider);
      const model = models.getModel("test-provider", "test-model");
      if (!model) {
        throw new Error("Faux model is missing");
      }
      const executor = new AgentRunExecutor(database.db, {
        agent: new PiAgentRunner({
          model,
          streamFn: models.streamSimple.bind(models),
        }),
        getToolSource: () => undefined,
      });

      await executor.execute(
        "run-pi-persisted",
        "task-pi-persisted",
        scheduledTime,
      );

      const storedRun = database.db
        .select()
        .from(runs)
        .where(eq(runs.id, "run-pi-persisted"))
        .get();
      const events = database.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, "run-pi-persisted"))
        .all();

      expect(storedRun).toMatchObject({
        status: "succeeded",
        transcriptSummary: "The daily signal remained stable.",
        resultJson: {
          schemaVersion: 1,
          body: {
            format: "markdown",
            content: "The daily signal remained stable.",
          },
        },
      });
      expect(events.map((event) => event.type)).toEqual([
        "run_started",
        "lifecycle",
        "message",
        "message",
        "usage",
        "lifecycle",
        "agent_output",
        "run_succeeded",
      ]);
      expect(events.map((event) => event.sequence)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7,
      ]);
    } finally {
      database.close();
    }
  });
});
