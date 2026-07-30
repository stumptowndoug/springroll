import {
  createMCPClient,
  type MCPClient,
  type MCPClientCapabilities,
  type OAuthClientProvider,
} from "@ai-sdk/mcp";
import type { Connection } from "./contracts.ts";
import {
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type ToolDescriptor,
  ToolPolicyError,
  type ToolResult,
  type ToolRisk,
  type ToolSource,
} from "./tools.ts";

export interface RemoteMcpToolSourceOptions {
  readonly id: string;
  readonly url: string | ((connection: Connection) => Promise<string> | string);
  readonly headers?: (
    connection: Connection,
  ) => Promise<Record<string, string>> | Record<string, string>;
  readonly authProvider?: (
    connection: Connection,
  ) => OAuthClientProvider | undefined;
  readonly capabilities?: MCPClientCapabilities;
  readonly maxRetries?: number;
  readonly clientName?: string;
}

export class RemoteMcpToolCallError extends Error {
  override readonly name = "RemoteMcpToolCallError";
}

export function createRemoteMcpToolSource(
  options: RemoteMcpToolSourceOptions,
): ToolSource {
  return {
    id: options.id,
    kind: "mcp",
    async open({ connection }) {
      if (connection.sourceId !== options.id) {
        throw new ToolPolicyError(
          `Connection ${connection.id} belongs to ${connection.sourceId}, not ${options.id}`,
        );
      }

      const url =
        typeof options.url === "function"
          ? await options.url(connection)
          : options.url;
      const headers = await options.headers?.(connection);
      const authProvider = options.authProvider?.(connection);
      const client = await createMCPClient({
        transport: {
          type: "http",
          url,
          ...(headers ? { headers } : {}),
          ...(authProvider ? { authProvider } : {}),
        },
        ...(options.capabilities ? { capabilities: options.capabilities } : {}),
        ...(options.maxRetries === undefined
          ? {}
          : { maxRetries: options.maxRetries }),
        clientName: options.clientName ?? "shrimp-roll",
      });

      return {
        listTools: () => listAllTools(client),
        async callTool(name, input, context) {
          const result = await client.callTool({
            name,
            arguments: input,
            ...(context.signal ? { options: { signal: context.signal } } : {}),
          });

          if ("toolResult" in result) {
            return {
              content: [toJsonValue(result.toolResult)],
            };
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
              message || `MCP tool failed: ${options.id}/${name}`,
            );
          }

          const toolResult: ToolResult = {
            content: result.content.map(toJsonValue),
            ...(result.structuredContent === undefined
              ? {}
              : {
                  structuredContent: toJsonObject(result.structuredContent),
                }),
          };

          return toolResult;
        },
        close: () => client.close(),
      };
    },
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
