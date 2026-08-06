import {
  createMCPClient,
  type MCPClient,
  type MCPClientCapabilities,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import {
  type ConnectorManifest,
  parseConnectorManifest,
} from "./connector-manifest.ts";
import { redactCredentialText } from "./credential-redaction.ts";
import type { CredentialStore } from "./credentials.ts";
import { createMcpToolSourceSession } from "./remote-mcp-tool-source.ts";
import { ToolPolicyError, type ToolSource } from "./tools.ts";

export interface LocalMcpToolSourceOptions {
  readonly manifest: ConnectorManifest;
  readonly credentials: CredentialStore;
  readonly capabilities?: MCPClientCapabilities;
  readonly maxRetries?: number;
  readonly clientName?: string;
}

export interface LocalMcpProcessConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export function createLocalMcpToolSource(
  options: LocalMcpToolSourceOptions,
): ToolSource {
  const manifest = parseConnectorManifest(options.manifest);
  if (manifest.transport.kind !== "mcp-local") {
    throw new TypeError(
      `Connector ${manifest.id} does not use the mcp-local transport`,
    );
  }

  return {
    id: manifest.transport.kind,
    kind: "mcp",
    async open({ connection, location }) {
      if (connection.sourceId !== manifest.transport.kind) {
        throw new ToolPolicyError(
          `Connection ${connection.id} belongs to ${connection.sourceId}, not ${manifest.transport.kind}`,
        );
      }
      if (location !== "local") {
        throw new ToolPolicyError(
          `Connector ${manifest.name} is installed on this Mac and cannot run hosted`,
        );
      }

      const secret =
        manifest.credential.kind === "api-key"
          ? await options.credentials.get(connection.credentialRef)
          : undefined;
      if (manifest.credential.kind === "api-key" && !secret) {
        throw new ToolPolicyError(
          `Connector ${manifest.name} needs reconnecting before it can run`,
        );
      }
      const processConfig = localMcpProcessConfig(manifest, secret);
      let client: MCPClient;
      try {
        client = await createMCPClient({
          transport: new Experimental_StdioMCPTransport({
            command: processConfig.command,
            args: [...processConfig.args],
            env: { ...processConfig.env },
            // Provider stderr is not part of a run transcript and may contain
            // accidental credential echoes, so do not inherit it into host logs.
            stderr: "ignore",
          }),
          ...(options.capabilities
            ? { capabilities: options.capabilities }
            : {}),
          ...(options.maxRetries === undefined
            ? {}
            : { maxRetries: options.maxRetries }),
          clientName: options.clientName ?? "springroll",
        });
      } catch (error) {
        const message = redactCredentialText(
          error instanceof Error ? error.message : String(error),
          [secret],
        );
        const safeError = new Error(message);
        safeError.name = error instanceof Error ? error.name : "Error";
        throw safeError;
      }
      return createMcpToolSourceSession(manifest, client, async () => [secret]);
    },
  };
}

export function localMcpProcessConfig(
  manifestValue: ConnectorManifest,
  secret?: string,
): LocalMcpProcessConfig {
  const manifest = parseConnectorManifest(manifestValue);
  if (manifest.transport.kind !== "mcp-local") {
    throw new TypeError(
      `Connector ${manifest.id} does not use the mcp-local transport`,
    );
  }
  const packageSpec = `${manifest.transport.package.name}@${manifest.transport.package.version}`;
  const env =
    manifest.credential.kind === "api-key"
      ? { [manifest.credential.env as string]: secret ?? "" }
      : {};

  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", packageSpec, ...(manifest.transport.args ?? [])],
    env,
  };
}
