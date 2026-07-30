import {
  type CredentialStore,
  createRemoteMcpToolSource,
  type JsonObject,
  ToolPolicyError,
  type ToolSource,
} from "@shrimp-roll/kernel";

export const hackerNewsConnectionId = "builtin-hacker-news";
export const hackerNewsSourceId = "native.hacker-news";
export const neonConnectionId = "neon-default";
export const neonSourceId = "mcp.neon";
export const neonCredentialRef = "neon-mcp-default";
export const openRouterCredentialRef = "openrouter-default";

export function createNeonToolSource(credentials: CredentialStore): ToolSource {
  return createRemoteMcpToolSource({
    id: neonSourceId,
    clientName: "shrimproll",
    url: (connection) => readUrl(connection.config),
    headers: async (connection) => {
      if (connection.credentialRef === "none") {
        return {};
      }

      const token = await credentials.get(connection.credentialRef);
      if (!token) {
        throw new ToolPolicyError("The Neon MCP connection needs reconnecting");
      }

      return {
        authorization: `Bearer ${token}`,
      };
    },
  });
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
