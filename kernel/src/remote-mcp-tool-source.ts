import {
  createMCPClient,
  type MCPClient,
  type MCPClientCapabilities,
  type OAuthClientProvider,
} from "@ai-sdk/mcp";
import {
  applyConnectorToolPolicy,
  type ConnectorManifest,
  parseConnectorManifest,
} from "./connector-manifest.ts";
import type { Connection } from "./contracts.ts";
import type { CredentialStore } from "./credentials.ts";
import {
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type ToolDescriptor,
  ToolPolicyError,
  type ToolResult,
  type ToolRisk,
  type ToolSource,
  type ToolSourceSession,
} from "./tools.ts";

export interface RemoteMcpToolSourceOptions {
  readonly manifest: ConnectorManifest;
  readonly credentials: CredentialStore;
  readonly authProvider?: (
    connection: Connection,
  ) => OAuthClientProvider | undefined;
  readonly capabilities?: MCPClientCapabilities;
  readonly maxRetries?: number;
  readonly clientName?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class RemoteMcpToolCallError extends Error {
  override readonly name = "RemoteMcpToolCallError";
}

export function createRemoteMcpToolSource(
  options: RemoteMcpToolSourceOptions,
): ToolSource {
  const manifest = parseConnectorManifest(options.manifest);
  if (manifest.transport.kind !== "mcp-remote") {
    throw new TypeError(
      `Connector ${manifest.id} does not use the mcp-remote transport`,
    );
  }
  const transport = manifest.transport;

  return {
    id: manifest.transport.kind,
    kind: "mcp",
    async open({ connection }) {
      if (connection.sourceId !== manifest.transport.kind) {
        throw new ToolPolicyError(
          `Connection ${connection.id} belongs to ${connection.sourceId}, not ${manifest.transport.kind}`,
        );
      }

      const headers = await credentialHeaders(
        manifest,
        connection,
        options.credentials,
      );
      const authProvider =
        manifest.credential.kind === "oauth"
          ? options.authProvider?.(connection)
          : undefined;
      const client = await createMCPClient({
        transport: {
          type: "http",
          url: transport.endpoint,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(authProvider ? { authProvider } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
        },
        ...(options.capabilities ? { capabilities: options.capabilities } : {}),
        ...(options.maxRetries === undefined
          ? {}
          : { maxRetries: options.maxRetries }),
        clientName: options.clientName ?? "springroll",
      });

      return createMcpToolSourceSession(manifest, client);
    },
  };
}

export function createMcpToolSourceSession(
  manifest: ConnectorManifest,
  client: MCPClient,
): ToolSourceSession {
  return {
    async listTools() {
      return applyConnectorToolPolicy(manifest, await listAllTools(client));
    },
    async callTool(name, input, context) {
      if (manifest.tools?.allow && !manifest.tools.allow.includes(name)) {
        throw new ToolPolicyError(`Unknown MCP tool: ${manifest.id}/${name}`);
      }
      const result = await client.callTool({
        name,
        arguments: input,
        ...(context.signal ? { options: { signal: context.signal } } : {}),
      });

      if ("toolResult" in result) {
        return { content: [toJsonValue(result.toolResult)] };
      }

      if (result.isError) {
        const message = result.content
          .filter(
            (
              item,
            ): item is Extract<
              (typeof result.content)[number],
              { type: "text" }
            > => item.type === "text",
          )
          .map((item) => item.text)
          .join("\n");

        throw new RemoteMcpToolCallError(
          message || `MCP tool failed: ${manifest.id}/${name}`,
        );
      }

      const toolResult: ToolResult = {
        content: result.content.map(toJsonValue),
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: toJsonObject(result.structuredContent) }),
      };
      return toolResult;
    },
    close: () => client.close(),
  };
}

async function credentialHeaders(
  manifest: ConnectorManifest,
  connection: Connection,
  credentials: CredentialStore,
): Promise<Record<string, string>> {
  if (manifest.credential.kind !== "api-key") return {};
  const secret = await credentials.get(connection.credentialRef);
  if (!secret) {
    throw new ToolPolicyError(
      `Connector ${manifest.name} needs reconnecting before it can run`,
    );
  }
  const header = manifest.credential.header ?? "authorization";
  return {
    [header]: manifest.credential.header ? secret : `Bearer ${secret}`,
  };
}

async function listAllTools(
  client: MCPClient,
): Promise<readonly ToolDescriptor[]> {
  const descriptors: ToolDescriptor[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listTools({
      ...(cursor ? { params: { cursor } } : {}),
    });

    descriptors.push(
      ...result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? tool.title ?? tool.name,
        inputSchema: toJsonObject(tool.inputSchema) as JsonSchema,
        ...(tool.outputSchema
          ? { outputSchema: toJsonObject(tool.outputSchema) as JsonSchema }
          : {}),
        ...(tool.annotations
          ? { declaredRisk: declaredRisk(tool.annotations) }
          : {}),
      })),
    );
    cursor = result.nextCursor;
  } while (cursor);

  return descriptors;
}

function declaredRisk(annotations: Record<string, unknown>): Partial<ToolRisk> {
  const effect =
    annotations.readOnlyHint === true
      ? "read"
      : annotations.destructiveHint === true
        ? "destructive"
        : annotations.destructiveHint === false
          ? "write"
          : undefined;

  return {
    ...(effect ? { effect } : {}),
    ...(typeof annotations.openWorldHint === "boolean"
      ? { openWorld: annotations.openWorldHint }
      : {}),
    ...(typeof annotations.idempotentHint === "boolean"
      ? { idempotent: annotations.idempotentHint }
      : {}),
  };
}

function toJsonObject(value: unknown): JsonObject {
  const normalized = toJsonValue(value);
  if (
    normalized === null ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  ) {
    throw new ToolPolicyError("Expected an MCP JSON object");
  }

  return normalized as JsonObject;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]),
    );
  }

  throw new ToolPolicyError(`MCP returned a non-JSON value: ${typeof value}`);
}
