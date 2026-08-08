import { describe, expect, test } from "bun:test";
import {
  createMarkdownRunResult,
  createNativeToolSource,
  hashToolSchema,
  inspectRecipeHistoryToolName,
  type JsonObject,
  proposeRecipeKnowledgeToolName,
} from "../src/index.ts";
import type { AgentRunner } from "../src/run-task.ts";
import { AgentRunExecutor } from "../src/storage/agent-run-executor.ts";
import { openLocalDatabase } from "../src/storage/database.ts";
import { connections, runs, tasks, taskTools } from "../src/storage/schema.ts";
import { SqliteRecipeKnowledgeStore } from "../src/storage/sqlite-recipe-knowledge-store.ts";

const source = createNativeToolSource("test.database", [
  {
    descriptor: {
      name: "run_sql",
      description: "Run a read-only fixture query.",
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
        additionalProperties: false,
      },
      declaredRisk: { effect: "read", openWorld: false, idempotent: true },
    },
    async execute() {
      return { content: [{ count: 4 }] };
    },
  },
]);

const learnedMarkdown = `# Daily usage

- Source: \`public.requests\`
- Count eligible requests using \`created_at\` in the recipe timezone.
- Reconcile columns against the live schema before querying.`;

describe("scheduled recipe knowledge", () => {
  test("captures one reviewable document and supplies it with prior-run context later", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      await seedRecipe(local.db);
      const observedRequests: Parameters<AgentRunner["run"]>[0][] = [];
      const agent: AgentRunner = {
        async run(request) {
          observedRequests.push(request);
          const proposal = request.tools.find(
            ({ descriptor }) =>
              descriptor.name === proposeRecipeKnowledgeToolName,
          );
          if (observedRequests.length === 1) {
            expect(proposal).toBeDefined();
            await proposal?.execute(
              { markdown: learnedMarkdown } as JsonObject,
              { taskId: request.task.id, runId: request.runId },
            );
          } else {
            expect(proposal).toBeUndefined();
            const history = request.tools.find(
              ({ descriptor }) =>
                descriptor.name === inspectRecipeHistoryToolName,
            );
            expect(history).toBeDefined();
            expect(
              await history?.execute(
                { runId: "run-one", limit: 5 },
                { taskId: request.task.id, runId: request.runId },
              ),
            ).toMatchObject({
              structuredContent: {
                status: "found",
                run: {
                  runId: "run-one",
                  report: "Four requests were recorded.",
                },
              },
            });
          }
          const startedAt = new Date("2026-08-07T16:00:00.000Z");
          return {
            result: createMarkdownRunResult({
              body: "Four requests were recorded.",
              fallbackSummary: "Four requests were recorded.",
            }),
            toolCalls: [],
            usage: {},
            startedAt,
            finishedAt: new Date(startedAt.getTime() + 1_000),
          };
        },
      };
      const executor = new AgentRunExecutor(local.db, {
        agent,
        getToolSource: (sourceId) =>
          sourceId === source.id ? source : undefined,
      });

      insertRun(
        local.db,
        "run-one",
        new Date("2026-08-07T16:00:00.000Z"),
        "manual-calibration",
      );
      await executor.execute(
        "run-one",
        "task-usage",
        new Date("2026-08-07T16:00:00.000Z"),
      );
      const knowledge = new SqliteRecipeKnowledgeStore(local.db);
      expect(knowledge.getCurrent("task-usage")).toMatchObject({
        revision: 1,
        status: "needs_review",
        sourceRunId: "run-one",
        knowledge: { schemaVersion: 1, markdown: learnedMarkdown },
      });

      knowledge.approve("task-usage", 1);
      insertRun(local.db, "run-two", new Date("2026-08-08T16:00:00.000Z"));
      await executor.execute(
        "run-two",
        "task-usage",
        new Date("2026-08-08T16:00:00.000Z"),
      );

      expect(observedRequests[1]?.recipeContext).toMatchObject({
        recipeKnowledge: {
          revision: 1,
          status: "ready",
          knowledge: { schemaVersion: 1, markdown: learnedMarkdown },
        },
        recentRuns: [
          {
            runId: "run-one",
            status: "succeeded",
            summary: "Four requests were recorded.",
          },
        ],
      });
    } finally {
      local.close();
    }
  });
});

async function seedRecipe(
  db: ReturnType<typeof openLocalDatabase>["db"],
): Promise<void> {
  const session = await source.open({
    connection: {
      id: "connection-db",
      sourceId: source.id,
      credentialRef: "none",
      availableIn: ["local"],
    },
    location: "local",
  });
  const [descriptor] = await session.listTools();
  await session.close();
  if (!descriptor) throw new Error("Fixture tool is missing");
  db.insert(tasks)
    .values({
      id: "task-usage",
      prompt: "Report daily API usage.",
      schedule: "0 9 * * *",
      scheduleTimezone: "America/Los_Angeles",
      enabled: true,
      catchUpPolicy: "skip_to_next",
      nextRunAt: new Date("2026-08-07T16:00:00.000Z"),
    })
    .run();
  db.insert(connections)
    .values({
      id: "connection-db",
      sourceId: source.id,
      credentialRef: "none",
      availableIn: ["local"],
    })
    .run();
  db.insert(taskTools)
    .values({
      taskId: "task-usage",
      connectionId: "connection-db",
      sourceId: source.id,
      name: descriptor.name,
      inputSchemaHash: await hashToolSchema(descriptor.inputSchema),
      maxCallsPerRun: 4,
      riskEffect: "read",
      riskOpenWorld: false,
      riskIdempotent: true,
      approval: "never",
    })
    .run();
}

function insertRun(
  db: ReturnType<typeof openLocalDatabase>["db"],
  id: string,
  scheduledTime: Date,
  manualRequestId?: string,
): void {
  db.insert(runs)
    .values({
      id,
      taskId: "task-usage",
      scheduledTime,
      manualRequestId,
      status: "claimed",
      executionLocation: "local",
    })
    .run();
}
