import {
  type ConnectorManifest,
  type ConnectorOAuthClientProvider,
  type CredentialStore,
  createExaWebToolSource,
  createOpenApiToolSource,
  createRemoteMcpToolSource,
  type FetchApi,
  type JsonObject,
  type RemoteMcpToolSourceOptions,
  ToolPolicyError,
  type ToolSource,
} from "@springroll/kernel";
import { curatedConnectorManifests } from "./connector-registry.ts";

export const hackerNewsConnectionId = "builtin-hacker-news";
export const hackerNewsSourceId = "native.hacker-news";
export const webConnectionId = "builtin-web";
export const webSourceId = "native.web";
export const neonConnectionId = "neon-default";
export const neonManifestId = "neon";
export const remoteMcpSourceId = "mcp-remote";
export const openApiSourceId = "openapi";
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

export function createNeonConnectorManifest(
  endpoint: string,
  needsToken: boolean,
): ConnectorManifest {
  return {
    id: neonManifestId,
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

export function createNeonOAuthConnectorManifest(
  endpoint = "https://mcp.neon.tech/mcp",
): ConnectorManifest {
  return {
    id: neonManifestId,
    name: "Neon",
    blurb: "<b>Postgres</b> — manage Neon projects and databases.",
    transport: { kind: "mcp-remote", endpoint },
    credential: { kind: "oauth" },
    probe: { tool: "list_projects", input: {} },
  };
}

export function createNeonApiKeyConnectorManifest(
  endpoint = "https://mcp.neon.tech/mcp",
): ConnectorManifest {
  return createNeonConnectorManifest(endpoint, true);
}

export const connectorRegistryManifests: readonly ConnectorManifest[] = [
  createNeonOAuthConnectorManifest(),
  ...curatedConnectorManifests,
];

export type ResolveConnectorManifest = (
  manifestId: string,
) => Promise<ConnectorManifest | undefined> | ConnectorManifest | undefined;

export function createManifestToolSources(
  resolveManifest: ResolveConnectorManifest,
  credentials: CredentialStore,
  request?: FetchApi,
  authProvider?: (
    manifest: ConnectorManifest,
    connection: Parameters<
      NonNullable<RemoteMcpToolSourceOptions["authProvider"]>
    >[0],
  ) => ConnectorOAuthClientProvider | undefined,
): readonly ToolSource[] {
  return [
    createResolvedManifestSource(
      remoteMcpSourceId,
      "mcp",
      resolveManifest,
      (manifest) =>
        createRemoteMcpToolSource({
          manifest,
          credentials,
          ...(authProvider
            ? {
                authProvider: (connection) =>
                  authProvider(manifest, connection),
              }
            : {}),
          ...(request ? { fetch: request as typeof fetch } : {}),
          clientName: "springroll",
        }),
    ),
    createResolvedManifestSource(
      openApiSourceId,
      "native",
      resolveManifest,
      (manifest) =>
        createOpenApiToolSource({
          manifest,
          credentials,
          ...(request ? { fetch: request } : undefined),
        }),
    ),
  ];
}

function createResolvedManifestSource(
  sourceId: typeof remoteMcpSourceId | typeof openApiSourceId,
  kind: ToolSource["kind"],
  resolveManifest: ResolveConnectorManifest,
  createSource: (manifest: ConnectorManifest) => ToolSource,
): ToolSource {
  const cached = new Map<
    string,
    { readonly encoded: string; readonly source: ToolSource }
  >();

  return {
    id: sourceId,
    kind,
    async open(options) {
      const manifestId = options.connection.manifestId;
      if (!manifestId) {
        throw new ToolPolicyError(
          `Connection ${options.connection.id} has no connector manifest`,
        );
      }
      const manifest = await resolveManifest(manifestId);
      if (!manifest) {
        throw new ToolPolicyError(`Unknown connector manifest: ${manifestId}`);
      }
      if (manifest.transport.kind !== sourceId) {
        throw new ToolPolicyError(
          `Connector ${manifest.id} uses ${manifest.transport.kind}, not ${sourceId}`,
        );
      }

      const encoded = JSON.stringify(manifest);
      const existing = cached.get(manifest.id);
      if (existing?.encoded === encoded) {
        return existing.source.open(options);
      }
      const source = createSource(manifest);
      cached.set(manifest.id, { encoded, source });
      return source.open(options);
    },
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
