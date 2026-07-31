import {
  type CredentialStore,
  createNativeToolSource,
  createRemoteMcpToolSource,
  type JsonObject,
  ToolPolicyError,
  type ToolSource,
} from "@shrimp-roll/kernel";

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

export function createWebToolSource(): ToolSource {
  return createNativeToolSource(webSourceId, [
    {
      descriptor: {
        name: "search_web",
        description:
          "Search the current public web. The agent chooses its search queries and may search more than once before answering.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The web search query.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        declaredRisk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        providerTool: {
          provider: "openrouter",
          name: "web_search",
        },
      },
      async execute() {
        throw new ToolPolicyError(
          "search_web must be executed by the selected model provider",
        );
      },
    },
    {
      descriptor: {
        name: "fetch_public_url",
        description:
          "Read a specific public web page or PDF. Use this after web search when the report needs details from a result URL.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The public URL to read.",
            },
          },
          required: ["url"],
          additionalProperties: false,
        },
        declaredRisk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        providerTool: {
          provider: "openrouter",
          name: "web_fetch",
        },
      },
      async execute() {
        throw new ToolPolicyError(
          "fetch_public_url must be executed by the selected model provider",
        );
      },
    },
  ]);
}

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
