import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { CodexAgentRunner } from "../src/codex-agent-runner.ts";
import {
  bundledCodexPath,
  CodexAppServerClient,
  type CodexAppServerProcess,
  CodexSubscriptionConnection,
} from "../src/codex-app-server.ts";
import type { AgentRunRequest } from "../src/run-task.ts";

class FakeCodexProcess extends EventEmitter implements CodexAppServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Record<string, unknown>[] = [];

  constructor(
    private readonly respond: (
      message: Record<string, unknown>,
      send: (message: unknown) => void,
    ) => void,
  ) {
    super();
    createInterface({ input: this.stdin }).on("line", (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      this.requests.push(message);
      this.respond(message, (response) => {
        this.stdout.write(`${JSON.stringify(response)}\n`);
      });
    });
  }

  kill(): boolean {
    return true;
  }
}

describe("Codex app-server integration", () => {
  test("can start after a missing runtime becomes available", async () => {
    let available = false;
    const child = new FakeCodexProcess((message, send) => {
      if (message.method === "initialize") send({ id: message.id, result: {} });
    });
    const client = new CodexAppServerClient({
      spawn: async () => {
        if (!available) throw new Error("Download support first");
        return child;
      },
    });
    await expect(client.start()).rejects.toThrow("Download support first");
    available = true;
    await client.start();
    expect(child.requests[0]?.method).toBe("initialize");
    client.close();
  });
  test("uses the SDK-bundled platform executable", () => {
    expect(bundledCodexPath()).toEndWith("/bin/codex");
  });

  test("initializes and reads the managed ChatGPT account", async () => {
    const process = new FakeCodexProcess((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: { userAgent: "codex" } });
      } else if (message.method === "account/read") {
        send({
          id: message.id,
          result: {
            account: {
              type: "chatgpt",
              email: "person@example.com",
              planType: "plus",
            },
            requiresOpenaiAuth: true,
          },
        });
      }
    });
    const client = new CodexAppServerClient({ spawn: () => process });
    const connection = new CodexSubscriptionConnection(client);

    expect(await connection.account()).toEqual({
      account: {
        type: "chatgpt",
        email: "person@example.com",
        planType: "plus",
      },
      requiresOpenaiAuth: true,
    });
    expect(process.requests.map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
    ]);
    client.close();
  });

  test("runs a recipe with Springroll tools and subscription usage", async () => {
    let process: FakeCodexProcess;
    process = new FakeCodexProcess((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: {} });
      } else if (message.method === "account/read") {
        send({
          id: message.id,
          result: { account: { type: "chatgpt" }, requiresOpenaiAuth: true },
        });
      } else if (message.method === "thread/start") {
        send({ id: message.id, result: { thread: { id: "thread-1" } } });
      } else if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "turn-1" } } });
        queueMicrotask(() =>
          send({
            id: 50,
            method: "item/tool/call",
            params: {
              threadId: "thread-1",
              turnId: "turn-1",
              callId: "call-1",
              namespace: null,
              tool: "springroll_tool_0",
              arguments: { topic: "today" },
            },
          }),
        );
      } else if (message.id === 50 && message.result) {
        send({
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            item: {
              type: "agentMessage",
              text: "## Result\n\nThe digest is ready.",
            },
          },
        });
        send({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            tokenUsage: {
              total: {
                totalTokens: 15,
                inputTokens: 10,
                cachedInputTokens: 4,
                outputTokens: 5,
                reasoningOutputTokens: 2,
              },
            },
          },
        });
        send({
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "completed", error: null },
          },
        });
      }
    });
    const calls: unknown[] = [];
    const runner = new CodexAgentRunner("gpt-5.6-sol", {
      spawn: () => process,
      maxSteps: 10,
    });
    const request: AgentRunRequest = {
      runId: "run-1",
      task: {
        id: "task-1",
        prompt: "Make the digest",
        enabled: true,
        nextRunAt: new Date("2026-09-03T12:00:00Z"),
        catchUpPolicy: "skip_to_next",
        tools: [],
      },
      tools: [
        {
          descriptor: {
            name: "read_digest",
            description: "Read the digest",
            inputSchema: { type: "object" },
          },
          policy: {
            sourceId: "test",
            connectionId: "test",
            name: "read_digest",
            inputSchemaHash: "hash",
            risk: { effect: "read", openWorld: false, idempotent: true },
            approval: "never",
          },
          async execute(input) {
            calls.push(input);
            return { content: [{ stories: 3 }] };
          },
        },
      ],
    };

    const result = await runner.run(request);

    expect(calls).toEqual([{ topic: "today" }]);
    expect(result.result.body.content).toBe(
      "## Result\n\nThe digest is ready.",
    );
    expect(result.toolCalls).toHaveLength(1);
    expect(result.usage).toEqual({
      provider: "codex",
      modelId: "gpt-5.6-sol",
      billing: "subscription",
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 2,
      cachedInputTokens: 4,
      totalTokens: 15,
    });
    const threadStart = process.requests.find(
      (candidate) => candidate.method === "thread/start",
    );
    expect(threadStart?.params).not.toHaveProperty("historyMode");
  });
});
