import { afterEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { RunTaskResult, Task } from "../src/contracts.ts";
import type { CredentialStore } from "../src/credentials.ts";
import { createRemoteMcpToolSource } from "../src/remote-mcp-tool-source.ts";
import { createMarkdownRunResult } from "../src/run-results.ts";
import { runTask } from "../src/run-task.ts";
import { hashToolSchema } from "../src/tools.ts";

const cleanup: Array<() => Promise<void> | void> = [];
const noCredentials: CredentialStore = {
  async get() {
    return undefined;
  },
  async put() {},
  async delete() {},
};

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

describe("createRemoteMcpToolSource", () => {
  test("discovers and calls a remote tool through the task policy pipeline", async () => {
    const calledWith: string[] = [];
    const servers = new Set<McpServer>();
    const sessions = new Map<
      string,
      {
        server: McpServer;
        transport: WebStandardStreamableHTTPServerTransport;
      }
    >();

    async function createSession() {
      const mcpServer = new McpServer({
        name: "test-connector",
        version: "1.0.0",
      });
      servers.add(mcpServer);
      mcpServer.registerTool(
        "summarize_topic",
        {
          description: "Return a short summary for a topic",
          inputSchema: {
            topic: z.string(),
          },
          outputSchema: {
            summary: z.string(),
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async ({ topic }) => {
          calledWith.push(topic);
          return {
            content: [
              {
                type: "text",
                text: `Summary: ${topic}`,
              },
            ],
            structuredContent: {
              summary: `Summary: ${topic}`,
            },
          };
        },
      );

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { server: mcpServer, transport });
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId);
        },
      });
      await mcpServer.connect(transport);

      return { server: mcpServer, transport };
    }

    const httpServer = Bun.serve({
      port: 0,
      async fetch(request) {
        const sessionId = request.headers.get("mcp-session-id");
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (!session) {
            return new Response("Unknown MCP session", { status: 404 });
          }

          return session.transport.handleRequest(request);
        }

        if (request.method !== "POST") {
          return new Response("MCP session required", { status: 400 });
        }

        const session = await createSession();
        return session.transport.handleRequest(request);
      },
    });
    cleanup.push(async () => {
      httpServer.stop(true);
      await Promise.allSettled(Array.from(servers, (server) => server.close()));
    });

    const source = createRemoteMcpToolSource({
      manifest: {
        id: "mcp.test",
        name: "Test connector",
        blurb: "<b>Test</b> — exercises remote MCP.",
        transport: {
          kind: "mcp-remote",
          endpoint: `http://127.0.0.1:${httpServer.port}/mcp`,
        },
        credential: { kind: "none" },
        probe: { tool: "summarize_topic", input: { topic: "probe" } },
      },
      credentials: noCredentials,
    });
    const connection = {
      id: "connection-test",
      sourceId: "mcp.test",
      credentialRef: "test-only",
      availableIn: ["local", "hosted"] as const,
    };
    const discovery = await source.open({
      connection,
      location: "local",
    });
    const [descriptor] = await discovery.listTools();
    await discovery.close();

    expect(descriptor?.declaredRisk).toEqual({
      effect: "read",
      openWorld: false,
      idempotent: true,
    });

    const task: Task = {
      id: "task-remote-mcp",
      prompt: "Summarize local-first software",
      enabled: true,
      nextRunAt: new Date("2026-07-31T15:00:00.000Z"),
      catchUpPolicy: "skip_to_next",
      tools: [
        {
          sourceId: source.id,
          connectionId: connection.id,
          name: "summarize_topic",
          inputSchemaHash: await hashToolSchema(
            descriptor?.inputSchema ?? { type: "object" },
          ),
          risk: {
            effect: "read",
            openWorld: false,
            idempotent: true,
          },
          approval: "never",
        },
      ],
    };

    const result = await runTask(
      {
        task,
        connections: [connection],
        location: "local",
      },
      {
        getToolSource: (sourceId) =>
          sourceId === source.id ? source : undefined,
        agent: {
          async run({ tools }): Promise<RunTaskResult> {
            const toolResult = await tools[0]?.execute(
              { topic: "local-first software" },
              { taskId: task.id, runId: "run-remote-mcp" },
            );

            return {
              result: createMarkdownRunResult({
                body: JSON.stringify(toolResult?.content),
                fallbackSummary: String(toolResult?.structuredContent?.summary),
                summary: String(toolResult?.structuredContent?.summary),
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

    expect(calledWith).toEqual(["local-first software"]);
    expect(result.result.summary).toBe("Summary: local-first software");
  });
});
