import { afterEach, describe, expect, test } from "bun:test";
import type { MCPClient } from "@ai-sdk/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ConnectorManifest } from "../src/connector-manifest.ts";
import type { RunTaskResult, Task } from "../src/contracts.ts";
import type { CredentialStore } from "../src/credentials.ts";
import { MissingCredentialError } from "../src/credentials.ts";
import {
  createMcpToolSourceSession,
  createRemoteMcpToolSource,
} from "../src/remote-mcp-tool-source.ts";
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

const credentialedManifest: ConnectorManifest = {
  id: "mcp.credential-test",
  name: "Credential test",
  blurb: "Exercises MCP credential boundaries.",
  transport: {
    kind: "mcp-remote",
    endpoint: "https://mcp.example.com/mcp",
  },
  credential: {
    kind: "api-key",
    placeholder: "Credential test key",
    header: "X-API-Key",
  },
};

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

describe("createRemoteMcpToolSource", () => {
  test("classifies a missing host credential before opening the transport", async () => {
    const source = createRemoteMcpToolSource({
      manifest: credentialedManifest,
      credentials: noCredentials,
    });

    await expect(
      source.open({
        connection: {
          id: "credential-test-default",
          sourceId: "mcp-remote",
          manifestId: credentialedManifest.id,
          credentialRef: "connector-credential-test-default",
          availableIn: ["local", "hosted"],
        },
        location: "local",
      }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

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
      },
      credentials: noCredentials,
    });
    const connection = {
      id: "connection-test",
      sourceId: "mcp-remote",
      manifestId: "mcp.test",
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

describe("MCP credential boundary", () => {
  test("redacts credentials from discovered schemas and successful tool results", async () => {
    const originalCredential = "credential-before-call";
    const refreshedCredential = "credential-after-call";
    let credentials = [originalCredential];
    let receivedArguments: unknown;
    const client = {
      async listTools() {
        return {
          tools: [
            {
              name: "inspect",
              description: `Never expose ${originalCredential}`,
              inputSchema: {
                type: "object",
                description: originalCredential,
              },
            },
          ],
        };
      },
      async callTool(request: { arguments?: unknown }) {
        receivedArguments = request.arguments;
        credentials = [refreshedCredential];
        return {
          content: [
            {
              type: "text",
              text: `old=${originalCredential}; new=${refreshedCredential}`,
            },
          ],
          structuredContent: {
            [originalCredential]: refreshedCredential,
          },
        };
      },
      async close() {},
    } as unknown as MCPClient;
    const session = createMcpToolSourceSession(
      credentialedManifest,
      client,
      async () => credentials,
    );

    const tools = await session.listTools();
    const result = await session.callTool(
      "inspect",
      { subject: "safe input" },
      { taskId: "task-1", runId: "run-1" },
    );

    expect(JSON.stringify(tools)).not.toContain(originalCredential);
    expect(tools[0]?.description).toBe("Never expose [REDACTED]");
    expect(receivedArguments).toEqual({ subject: "safe input" });
    expect(JSON.stringify(receivedArguments)).not.toContain("credential-");
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "old=[REDACTED]; new=[REDACTED]",
        },
      ],
      structuredContent: { "[REDACTED]": "[REDACTED]" },
    });
    expect(JSON.stringify(result)).not.toContain("credential-");
  });

  test("redacts credentials from returned and thrown MCP failures", async () => {
    const credential = "credential-in-error";
    const returnedFailure = createMcpToolSourceSession(
      credentialedManifest,
      {
        async callTool() {
          return {
            isError: true,
            content: [{ type: "text", text: `rejected ${credential}` }],
          };
        },
        async close() {},
      } as unknown as MCPClient,
      async () => [credential],
    );
    const thrownFailure = createMcpToolSourceSession(
      credentialedManifest,
      {
        async callTool() {
          throw new Error(`transport echoed ${credential}`);
        },
        async close() {},
      } as unknown as MCPClient,
      async () => [credential],
    );

    await expect(
      returnedFailure.callTool(
        "inspect",
        {},
        { taskId: "task-1", runId: "run-1" },
      ),
    ).rejects.toThrow("rejected [REDACTED]");
    await expect(
      thrownFailure.callTool(
        "inspect",
        {},
        { taskId: "task-1", runId: "run-1" },
      ),
    ).rejects.toThrow("transport echoed [REDACTED]");
  });
});
