import { timingSafeEqual } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ZodError } from "zod";
import type {
  ApplicationToolDefinition,
  ApplicationToolRegistry,
} from "./application-tool-registry.ts";

export interface SpringrollMcpConnection {
  readonly server: McpServer;
  close(): Promise<void>;
}

export interface SpringrollMcpHttpEndpoint {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

export interface SpringrollMcpHttpOptions {
  /** Supplied by the host from Keychain or an explicit development setting. */
  readonly bearerToken: string;
}

/** Official MCP SDK projection of the shared Springroll tool registry. */
export function createSpringrollMcpServer(
  registry: ApplicationToolRegistry,
): McpServer {
  const server = new McpServer({ name: "springroll", version: "0.0.0" });
  for (const definition of registry.definitions) {
    server.registerTool(
      definition.name,
      {
        description: definition.descriptor.description,
        inputSchema: definition.inputSchema,
        annotations: mcpAnnotations(definition),
        _meta: {
          "springroll/approval": definition.policy.approval,
          "springroll/workflow": definition.policy.workflow,
        },
      },
      async (input, extra) => {
        try {
          const result = await registry.execute(definition.name, input, {
            callId: String(extra.requestId),
            signal: extra.signal,
            priorCalls: [],
          });
          return toMcpResult(result);
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: safeMcpError(error) }],
          };
        }
      },
    );
  }
  return server;
}

export async function connectSpringrollMcpStdio(
  registry: ApplicationToolRegistry,
  streams: {
    readonly input?: Readable;
    readonly output?: Writable;
  } = {},
): Promise<SpringrollMcpConnection> {
  const server = createSpringrollMcpServer(registry);
  const transport = new StdioServerTransport(
    streams.input ?? process.stdin,
    streams.output ?? process.stdout,
  );
  await server.connect(transport);
  return {
    server,
    close: () => server.close(),
  };
}

/**
 * Creates a stateful streamable-HTTP endpoint restricted to loopback callers
 * and a host-supplied bearer token. The token is never persisted here or
 * returned in protocol data.
 */
export function createSpringrollMcpHttpEndpoint(
  registry: ApplicationToolRegistry,
  options: SpringrollMcpHttpOptions,
): SpringrollMcpHttpEndpoint {
  if (!options.bearerToken.trim()) {
    throw new Error("Springroll MCP HTTP requires a bearer token");
  }
  const sessions = new Map<
    string,
    {
      readonly server: McpServer;
      readonly transport: WebStandardStreamableHTTPServerTransport;
    }
  >();
  const servers = new Set<McpServer>();

  async function createSession() {
    const server = createSpringrollMcpServer(registry);
    servers.add(server);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized(sessionId) {
        sessions.set(sessionId, { server, transport });
      },
      onsessionclosed(sessionId) {
        sessions.delete(sessionId);
        servers.delete(server);
      },
    });
    await server.connect(transport);
    return { server, transport };
  }

  return {
    async fetch(request) {
      if (!isLoopbackRequest(request)) {
        return new Response("Springroll MCP is available only on loopback", {
          status: 403,
        });
      }
      if (!hasBearerToken(request, options.bearerToken)) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "www-authenticate": "Bearer" },
        });
      }

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
    async close() {
      sessions.clear();
      const openServers = Array.from(servers);
      servers.clear();
      await Promise.allSettled(openServers.map((server) => server.close()));
    },
  };
}

function mcpAnnotations(definition: ApplicationToolDefinition) {
  const risk = definition.policy.risk;
  return {
    readOnlyHint: risk.effect === "read",
    destructiveHint: risk.effect === "destructive",
    idempotentHint: risk.idempotent,
    openWorldHint: risk.openWorld,
  };
}

function toMcpResult(value: unknown) {
  const json = toJsonValue(value);
  const structuredContent = isUnknownObject(json) ? json : { value: json };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(json) }],
    structuredContent,
  };
}

function toJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function safeMcpError(error: unknown): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return `Invalid tool input${location}`;
  }
  if (
    error instanceof Error &&
    error.message.startsWith("Unknown Springroll application tool:")
  ) {
    return error.message;
  }
  return "Springroll could not complete this tool call";
}

function isLoopbackRequest(request: Request): boolean {
  const requestHostname = new URL(request.url).hostname;
  if (!isLoopbackHostname(requestHostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function hasBearerToken(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
