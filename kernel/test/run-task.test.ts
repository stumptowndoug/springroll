import { describe, expect, test } from "bun:test";
import type { RunTaskResult, Task } from "../src/contracts.ts";
import { createMarkdownRunResult } from "../src/run-results.ts";
import { runTask } from "../src/run-task.ts";
import {
  createNativeToolSource,
  hashToolSchema,
  type JsonSchema,
  ToolPolicyError,
} from "../src/tools.ts";

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    topic: {
      type: "string",
    },
  },
  required: ["topic"],
};

async function createTask(): Promise<Task> {
  return {
    id: "task-hn",
    prompt: "Summarize Hacker News",
    enabled: true,
    nextRunAt: new Date("2026-07-31T15:00:00.000Z"),
    catchUpPolicy: "catch_up",
    tools: [
      {
        sourceId: "native.web",
        connectionId: "connection-web",
        name: "fetch_feed",
        inputSchemaHash: await hashToolSchema(inputSchema),
        risk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        approval: "never",
      },
    ],
  };
}

describe("runTask", () => {
  test("runs a pinned native tool through the shared source boundary", async () => {
    const calls: string[] = [];
    const runIds: string[] = [];
    const source = createNativeToolSource("native.web", [
      {
        descriptor: {
          name: "fetch_feed",
          description: "Fetch an allowlisted feed",
          inputSchema,
        },
        async execute(input) {
          calls.push(String(input.topic));
          return {
            content: ["A story about local-first software"],
          };
        },
      },
    ]);

    const result = await runTask(
      {
        runId: "run-1",
        task: await createTask(),
        connections: [
          {
            id: "connection-web",
            sourceId: "native.web",
            credentialRef: "none",
            availableIn: ["local", "hosted"],
          },
        ],
        location: "local",
      },
      {
        getToolSource: (sourceId) =>
          sourceId === source.id ? source : undefined,
        agent: {
          async run({ runId, tools }): Promise<RunTaskResult> {
            runIds.push(runId);
            await tools[0]?.execute(
              { topic: "news" },
              { taskId: "task-hn", runId },
            );

            return {
              result: createMarkdownRunResult({
                body: "One story stood out.",
                fallbackSummary: "HN digest",
                summary: "HN digest",
              }),
              toolCalls: [],
              usage: {},
              startedAt: new Date("2026-07-31T15:00:00.000Z"),
              finishedAt: new Date("2026-07-31T15:00:01.000Z"),
            };
          },
        },
      },
    );

    expect(calls).toEqual(["news"]);
    expect(runIds).toEqual(["run-1"]);
    expect(result.result.summary).toBe("HN digest");
  });

  test("rejects a tool whose input schema changed after confirmation", async () => {
    const source = createNativeToolSource("native.web", [
      {
        descriptor: {
          name: "fetch_feed",
          description: "Fetch any URL",
          inputSchema: {
            ...inputSchema,
            properties: {
              url: {
                type: "string",
              },
            },
          },
        },
        async execute() {
          return { content: [] };
        },
      },
    ]);

    await expect(
      runTask(
        {
          task: await createTask(),
          connections: [
            {
              id: "connection-web",
              sourceId: "native.web",
              credentialRef: "none",
              availableIn: ["local"],
            },
          ],
          location: "local",
        },
        {
          getToolSource: () => source,
          agent: {
            async run() {
              throw new Error("agent should not run");
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(ToolPolicyError);
  });
});
