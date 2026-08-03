import {
  type ConnectorManifest,
  type CredentialStore,
  createExaWebToolSource,
  createRemoteMcpToolSource,
  type FetchApi,
  type JsonObject,
  ToolPolicyError,
  type ToolSource,
} from "@springroll/kernel";

export const hackerNewsConnectionId = "builtin-hacker-news";
export const hackerNewsSourceId = "native.hacker-news";
export const webConnectionId = "builtin-web";
export const webSourceId = "native.web";
export const neonConnectionId = "neon-default";
export const neonSourceId = "mcp.neon";
export const neonCredentialRef = "neon-mcp-default";
export const openRouterCredentialRef = "openrouter-default";
export const openAiCredentialRef = "openai-default";
export const xaiCredentialRef = "xai-default";
export const exaCredentialRef = "exa-web-default";

export function createWebToolSource(
  credentials: CredentialStore,
  request?: FetchApi,
): ToolSource {
  return createExaWebToolSource({
    id: webSourceId,
    credentialRef: exaCredentialRef,
    credentials,
    ...(request ? { fetch: request } : undefined),
  });
}

export function createNeonToolSource(credentials: CredentialStore): ToolSource {
  return {
    id: neonSourceId,
    kind: "mcp",
    async open(options) {
      const manifest = createNeonConnectorManifest(
        readUrl(options.connection.config),
        options.connection.credentialRef !== "none",
      );
      return createRemoteMcpToolSource({
        manifest,
        credentials,
        clientName: "springroll",
      }).open(options);
    },
  };
}

export function createNeonConnectorManifest(
  endpoint: string,
  needsToken: boolean,
): ConnectorManifest {
  return {
    id: neonSourceId,
    name: "Neon",
    blurb: "<b>Postgres</b> — manage Neon projects and databases.",
    transport: { kind: "mcp-remote", endpoint },
    credential: needsToken
      ? {
          kind: "api-key",
          placeholder: "Your Neon API key",
          keyCreationUrl: "https://console.neon.tech/app/settings/api-keys",
        }
      : { kind: "none" },
    probe: { tool: "list_projects", input: {} },
  };
}

export function readUrl(config: JsonObject | undefined): string {
  const value = config?.url;
  if (typeof value !== "string") {
    throw new ToolPolicyError("The Neon MCP connection has no endpoint URL");
  }

  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new ToolPolicyError(
      "The Neon MCP endpoint must use HTTPS or localhost",
    );
  }

  return url.toString();
}
