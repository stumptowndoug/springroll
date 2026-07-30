import type { Connection, ExecutionLocation } from "./contracts.ts";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonSchema = JsonObject;

export type ToolEffect = "read" | "write" | "destructive";
export type ApprovalPolicy = "never" | "before_call";

export interface ToolRisk {
  readonly effect: ToolEffect;
  readonly openWorld: boolean;
  readonly idempotent: boolean;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly declaredRisk?: Partial<ToolRisk>;
}

export interface PinnedTool {
  readonly sourceId: string;
  readonly connectionId: string;
  readonly name: string;
  readonly inputSchemaHash: string;
  readonly risk: ToolRisk;
  readonly approval: ApprovalPolicy;
}

export interface ToolCallContext {
  readonly taskId: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
}

export interface ToolResult {
  readonly content: readonly JsonValue[];
  readonly structuredContent?: JsonObject;
}

export interface ToolSourceSession {
  listTools(): Promise<readonly ToolDescriptor[]>;
  callTool(
    name: string,
    input: JsonObject,
    context: ToolCallContext,
  ): Promise<ToolResult>;
  close(): Promise<void>;
}

export interface ToolSourceOpenOptions {
  readonly connection: Connection;
  readonly location: ExecutionLocation;
}

export interface ToolSource {
  readonly id: string;
  readonly kind: "native" | "mcp";
  open(options: ToolSourceOpenOptions): Promise<ToolSourceSession>;
}

export interface ExecutableTool {
  readonly descriptor: ToolDescriptor;
  readonly policy: PinnedTool;
  execute(input: JsonObject, context: ToolCallContext): Promise<ToolResult>;
}

export interface NativeTool {
  readonly descriptor: ToolDescriptor;
  execute(input: JsonObject, context: ToolCallContext): Promise<ToolResult>;
}

export class ToolPolicyError extends Error {
  override readonly name = "ToolPolicyError";
}

export function createNativeToolSource(
  id: string,
  tools: readonly NativeTool[],
): ToolSource {
  const toolsByName = new Map(
    tools.map((tool) => [tool.descriptor.name, tool]),
  );

  return {
    id,
    kind: "native",
    async open() {
      return {
        async listTools() {
          return tools.map((tool) => tool.descriptor);
        },
        async callTool(name, input, context) {
          const tool = toolsByName.get(name);
          if (!tool) {
            throw new ToolPolicyError(`Unknown native tool: ${id}/${name}`);
          }

          return tool.execute(input, context);
        },
        async close() {},
      };
    },
  };
}

export async function hashToolSchema(schema: JsonSchema): Promise<string> {
  const encoded = new TextEncoder().encode(stableStringify(schema));
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function resolvePinnedTools(
  session: ToolSourceSession,
  pins: readonly PinnedTool[],
): Promise<readonly ExecutableTool[]> {
  const descriptors = new Map(
    (await session.listTools()).map((tool) => [tool.name, tool]),
  );

  return Promise.all(
    pins.map(async (pin) => {
      const descriptor = descriptors.get(pin.name);
      if (!descriptor) {
        throw new ToolPolicyError(
          `Pinned tool is no longer available: ${pin.sourceId}/${pin.name}`,
        );
      }

      const actualHash = await hashToolSchema(descriptor.inputSchema);
      if (actualHash !== pin.inputSchemaHash) {
        throw new ToolPolicyError(
          `Pinned tool schema changed: ${pin.sourceId}/${pin.name}`,
        );
      }

      return {
        descriptor,
        policy: pin,
        execute: (input: JsonObject, context: ToolCallContext) =>
          session.callTool(pin.name, input, context),
      };
    }),
  );
}

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
