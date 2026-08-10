import {
  type ConnectorManifest,
  parseConnectorManifest,
} from "@springroll/kernel";

export interface ConnectorRegistryMetadata {
  readonly operator: string;
  readonly oauthReady: boolean;
}

const registryValues: readonly [
  ConnectorManifest,
  ConnectorRegistryMetadata,
][] = [
  [
    {
      id: "gmail",
      name: "Gmail",
      blurb:
        "<b>Email</b> — search and work with mail through Google's official MCP server.",
      tags: ["email"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
      },
      credential: { kind: "oauth" },
    },
    { operator: "Google", oauthReady: false },
  ],
  [
    {
      id: "github",
      name: "GitHub",
      blurb:
        "<b>Code</b> — work with repositories through GitHub's official MCP server.",
      tags: ["code"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://api.githubcopilot.com/mcp/readonly",
      },
      credential: {
        kind: "api-key",
        placeholder: "Your fine-grained GitHub token",
        keyCreationUrl:
          "https://github.com/settings/personal-access-tokens/new",
      },
    },
    { operator: "GitHub", oauthReady: false },
  ],
  [
    {
      id: "jira",
      name: "Jira",
      blurb:
        "<b>Planning</b> — work with Jira through Atlassian's official MCP server.",
      tags: ["planning"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.atlassian.com/v1/mcp/authv2",
      },
      credential: { kind: "oauth" },
    },
    { operator: "Atlassian", oauthReady: true },
  ],
  [
    {
      id: "notion",
      name: "Notion",
      blurb:
        "<b>Workspace</b> — work with pages and comments through Notion's official MCP server.",
      tags: ["workspace"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.notion.com/mcp",
      },
      credential: { kind: "oauth" },
    },
    { operator: "Notion", oauthReady: true },
  ],
  [
    {
      id: "slack",
      name: "Slack",
      blurb:
        "<b>Messages</b> — work with conversations through Slack's official MCP server.",
      tags: ["messaging"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.slack.com/mcp",
      },
      credential: { kind: "oauth" },
    },
    { operator: "Slack", oauthReady: false },
  ],
  [
    {
      id: "linear",
      name: "Linear",
      blurb:
        "<b>Planning</b> — work with issues and projects through Linear's official MCP server.",
      tags: ["planning"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.linear.app/mcp/readonly",
      },
      credential: { kind: "oauth" },
    },
    { operator: "Linear", oauthReady: true },
  ],
];

export const curatedConnectorManifests: readonly ConnectorManifest[] =
  registryValues.map(([manifest]) => parseConnectorManifest(manifest));

export const connectorRegistryMetadata = new Map(
  registryValues.map(([manifest, metadata]) => [manifest.id, metadata]),
);
