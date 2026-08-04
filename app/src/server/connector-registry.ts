import {
  type ConnectorManifest,
  parseConnectorManifest,
} from "@springroll/kernel";

export interface ConnectorRegistryMetadata {
  readonly operator: string;
  readonly oauthReady: boolean;
}

const readRisk = {
  effect: "read" as const,
  openWorld: true,
  idempotent: true,
};

const registryValues: readonly [
  ConnectorManifest,
  ConnectorRegistryMetadata,
][] = [
  [
    {
      id: "gmail",
      name: "Gmail",
      blurb: "<b>Email</b> — search and read mail without sending it.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
      },
      credential: { kind: "oauth" },
      probe: { tool: "list_labels", input: {} },
      tools: {
        allow: [
          "list_labels",
          "search_threads",
          "get_thread",
          "get_message",
          "list_drafts",
        ],
        risk: {
          list_labels: readRisk,
          search_threads: readRisk,
          get_thread: readRisk,
          get_message: readRisk,
          list_drafts: readRisk,
        },
      },
    },
    { operator: "Google", oauthReady: false },
  ],
  [
    {
      id: "github",
      name: "GitHub",
      blurb: "<b>Code</b> — inspect repositories, issues, and pull requests.",
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
      probe: { tool: "get_me", input: {} },
      tools: {
        allow: [
          "get_me",
          "search_repositories",
          "get_file_contents",
          "issue_read",
          "pull_request_read",
          "search_code",
        ],
        risk: {
          get_me: readRisk,
          search_repositories: readRisk,
          get_file_contents: readRisk,
          issue_read: readRisk,
          pull_request_read: readRisk,
          search_code: readRisk,
        },
      },
    },
    { operator: "GitHub", oauthReady: false },
  ],
  [
    {
      id: "jira",
      name: "Jira",
      blurb:
        "<b>Planning</b> — find projects, search work items, and read issue details.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.atlassian.com/v1/mcp/authv2",
      },
      credential: { kind: "oauth" },
      probe: { tool: "atlassianUserInfo", input: {} },
      tools: {
        allow: [
          "atlassianUserInfo",
          "getAccessibleAtlassianResources",
          "getJiraIssue",
          "getVisibleJiraProjects",
          "searchJiraIssuesUsingJql",
          "getTransitionsForJiraIssue",
        ],
        risk: {
          atlassianUserInfo: readRisk,
          getAccessibleAtlassianResources: readRisk,
          getJiraIssue: readRisk,
          getVisibleJiraProjects: readRisk,
          searchJiraIssuesUsingJql: readRisk,
          getTransitionsForJiraIssue: readRisk,
        },
      },
    },
    { operator: "Atlassian", oauthReady: true },
  ],
  [
    {
      id: "notion",
      name: "Notion",
      blurb: "<b>Workspace</b> — find, read, and update pages and comments.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.notion.com/mcp",
      },
      credential: { kind: "oauth" },
      probe: { tool: "notion-fetch", input: { id: "self" } },
      tools: {
        allow: [
          "notion-search",
          "notion-fetch",
          "notion-get-comments",
          "notion-create-pages",
          "notion-update-page",
        ],
        risk: {
          "notion-search": readRisk,
          "notion-fetch": readRisk,
          "notion-get-comments": readRisk,
          "notion-create-pages": {
            effect: "write",
            openWorld: true,
            idempotent: false,
          },
          "notion-update-page": {
            effect: "write",
            openWorld: true,
            idempotent: false,
          },
        },
      },
    },
    { operator: "Notion", oauthReady: true },
  ],
  [
    {
      id: "slack",
      name: "Slack",
      blurb: "<b>Messages</b> — search channels and read conversation context.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.slack.com/mcp",
      },
      credential: { kind: "oauth" },
      probe: { tool: "search_channels", input: { query: "general" } },
      tools: {
        allow: [
          "search_channels",
          "search_messages",
          "read_channel",
          "read_thread",
          "read_user_profile",
          "list_channel_members",
        ],
        risk: {
          search_channels: readRisk,
          search_messages: readRisk,
          read_channel: readRisk,
          read_thread: readRisk,
          read_user_profile: readRisk,
          list_channel_members: readRisk,
        },
      },
    },
    { operator: "Slack", oauthReady: false },
  ],
  [
    {
      id: "linear",
      name: "Linear",
      blurb: "<b>Planning</b> — inspect issues, projects, cycles, and teams.",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.linear.app/mcp/readonly",
      },
      credential: { kind: "oauth" },
      probe: { tool: "list_teams", input: { limit: 1 } },
      tools: {
        allow: [
          "list_teams",
          "list_issues",
          "get_issue",
          "list_projects",
          "get_project",
          "list_cycles",
        ],
        risk: {
          list_teams: readRisk,
          list_issues: readRisk,
          get_issue: readRisk,
          list_projects: readRisk,
          get_project: readRisk,
          list_cycles: readRisk,
        },
      },
    },
    { operator: "Linear", oauthReady: true },
  ],
];

export const curatedConnectorManifests: readonly ConnectorManifest[] =
  registryValues.map(([manifest]) => parseConnectorManifest(manifest));

export const connectorRegistryMetadata = new Map(
  registryValues.map(([manifest, metadata]) => [manifest.id, metadata]),
);
