import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createSpringrollMcpHttpEndpoint,
  createSpringrollMcpServer,
} from "../src/server/application-mcp.ts";
import {
  type ApplicationToolRegistry,
  createSpringrollApplicationToolRegistry,
  type SpringrollApplicationReadApi,
} from "../src/server/application-tool-registry.ts";
import { type AppApi, createHttpApp } from "../src/server/http-app.ts";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

describe("Springroll application MCP adapter", () => {
  test("projects shared schema, policy, result, and validation through MCP", async () => {
    const calls: string[] = [];
    const registry = taskRegistry(calls);
    const direct = await registry.execute(
      "springroll_get_task",
      { taskId: "task-1" },
      { callId: "direct" },
    );
    const client = await connectInMemory(registry);

    const tools = await client.listTools();
    const getTask = tools.tools.find(
      ({ name }) => name === "springroll_get_task",
    );
    expect(getTask).toMatchObject({
      description: registry.get("springroll_get_task")?.descriptor.description,
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        "springroll/approval": "never",
        "springroll/workflow": "inspect",
      },
    });

    const result = await client.callTool({
      name: "springroll_get_task",
      arguments: { taskId: "task-1" },
    });
    expect(result.structuredContent).toEqual(direct);
    expect(result.isError).not.toBe(true);
    expect(calls).toEqual(["task-1", "task-1"]);

    const invalid = await client.callTool({
      name: "springroll_get_task",
      arguments: {},
    });
    expect(invalid.isError).toBe(true);
    expect(calls).toEqual(["task-1", "task-1"]);

    const bypass = await client.callTool({
      name: "springroll_call_connection_tool",
      arguments: {
        connectionId: "crm",
        toolName: "delete_contact",
        input: { contactId: "contact-1" },
      },
    });
    expect(bypass.isError).toBe(true);
    expect(calls).toEqual(["task-1", "task-1"]);
  });

  test("serves the same contract over authenticated loopback HTTP", async () => {
    const calls: string[] = [];
    const endpoint = createSpringrollMcpHttpEndpoint(taskRegistry(calls), {
      bearerToken: "test-local-token",
    });
    cleanup.push(() => endpoint.close());

    const unauthorized = await endpoint.fetch(
      new Request("http://127.0.0.1:4117/mcp", { method: "POST" }),
    );
    expect(unauthorized.status).toBe(401);
    const nonLoopback = await endpoint.fetch(
      new Request("http://springroll.example/mcp", {
        method: "POST",
        headers: { authorization: "Bearer test-local-token" },
      }),
    );
    expect(nonLoopback.status).toBe(403);
    const crossOrigin = await endpoint.fetch(
      new Request("http://127.0.0.1:4117/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-local-token",
          origin: "https://attacker.example",
        },
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const httpApp = createHttpApp({} as AppApi, undefined, undefined, endpoint);
    const httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: httpApp.fetch,
    });
    cleanup.push(() => httpServer.stop(true));
    const client = new Client({ name: "http-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${httpServer.port}/mcp`),
      {
        requestInit: {
          headers: { authorization: "Bearer test-local-token" },
        },
      },
    );
    await client.connect(
      transport as unknown as Parameters<Client["connect"]>[0],
    );
    cleanup.push(() => client.close());

    expect(await callTask(client, "task-http")).toEqual({
      found: true,
      task: { id: "task-http", name: "Fixture task", enabled: false },
    });
    expect(calls).toEqual(["task-http"]);
  });

  test("serves the same result over the official stdio transport", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "springroll-mcp-stdio-"),
    );
    cleanup.push(() => rmSync(temporaryDirectory, { recursive: true }));
    const entrypoint = new URL("../src/server.ts", import.meta.url).pathname;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "--mcp-stdio"],
      env: {
        ...getDefaultEnvironment(),
        SPRINGROLL_DB_PATH: join(temporaryDirectory, "springroll.sqlite"),
        SPRINGROLL_MODEL_CATALOG_PATH: join(
          temporaryDirectory,
          "models.sqlite",
        ),
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    cleanup.push(() => client.close());

    expect(await callTask(client, "task-stdio")).toEqual({
      found: false,
      taskId: "task-stdio",
    });
  });
});

function taskRegistry(calls: string[] = []): ApplicationToolRegistry {
  const application = {
    async getTask(taskId: string) {
      calls.push(taskId);
      return { id: taskId, name: "Fixture task", enabled: false };
    },
  } as unknown as SpringrollApplicationReadApi;
  return createSpringrollApplicationToolRegistry(application);
}

async function connectInMemory(
  registry: ApplicationToolRegistry,
): Promise<Client> {
  const server = createSpringrollMcpServer(registry);
  const client = new Client({ name: "memory-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(
    () => client.close(),
    () => server.close(),
  );
  return client;
}

async function callTask(client: Client, taskId: string): Promise<unknown> {
  const result = await client.callTool({
    name: "springroll_get_task",
    arguments: { taskId },
  });
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}
