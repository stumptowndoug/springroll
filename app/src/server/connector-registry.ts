import {
  type ConnectorManifest,
  parseConnectorManifest,
} from "@springroll/kernel";

export interface ConnectorRegistryMetadata {
  readonly operator: string;
  readonly actionable?: boolean;
}

const registryValues: readonly [
  ConnectorManifest,
  ConnectorRegistryMetadata,
][] = [
  [
    {
      id: "github",
      name: "GitHub",
      blurb:
        "<b>Code</b> — work with repositories through GitHub's official MCP server.",
      tags: ["code"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://api.githubcopilot.com/mcp/",
      },
      credential: { kind: "oauth" },
    },
    { operator: "GitHub" },
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
    { operator: "Atlassian" },
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
    { operator: "Slack", actionable: false },
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
    { operator: "Linear" },
  ],
  [
    {
      id: "gmail",
      name: "Gmail",
      blurb:
        "<b>Email</b> — safely search and read mail through Google's Gmail API.",
      tags: ["email", "google"],
      transport: {
        kind: "http-api",
        baseUrl: "https://gmail.googleapis.com/gmail/v1",
        operations: [
          {
            name: "search_threads",
            description:
              "Search Gmail threads with Gmail search operators and pagination.",
            method: "GET",
            path: "/users/me/threads",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                maxResults: { type: "integer", minimum: 1, maximum: 100 },
                pageToken: { type: "string" },
                includeSpamTrash: { type: "boolean" },
              },
              additionalProperties: false,
            },
            parameters: [
              {
                input: "query",
                name: "q",
                location: "query",
                required: false,
              },
              {
                input: "maxResults",
                name: "maxResults",
                location: "query",
                required: false,
              },
              {
                input: "pageToken",
                name: "pageToken",
                location: "query",
                required: false,
              },
              {
                input: "includeSpamTrash",
                name: "includeSpamTrash",
                location: "query",
                required: false,
              },
            ],
            effect: "read",
          },
          {
            name: "get_thread",
            description:
              "Read a Gmail thread with its messages, headers, bodies, and attachments metadata.",
            method: "GET",
            path: "/users/me/threads/{threadId}",
            inputSchema: {
              type: "object",
              properties: {
                threadId: { type: "string" },
                format: {
                  type: "string",
                  enum: ["full", "metadata", "minimal"],
                },
              },
              required: ["threadId"],
              additionalProperties: false,
            },
            parameters: [
              {
                input: "threadId",
                name: "threadId",
                location: "path",
                required: true,
              },
              {
                input: "format",
                name: "format",
                location: "query",
                required: false,
              },
            ],
            effect: "read",
          },
          {
            name: "get_message",
            description:
              "Read one Gmail message with headers, body, and attachments metadata.",
            method: "GET",
            path: "/users/me/messages/{messageId}",
            inputSchema: {
              type: "object",
              properties: {
                messageId: { type: "string" },
                format: {
                  type: "string",
                  enum: ["full", "metadata", "minimal", "raw"],
                },
              },
              required: ["messageId"],
              additionalProperties: false,
            },
            parameters: [
              {
                input: "messageId",
                name: "messageId",
                location: "path",
                required: true,
              },
              {
                input: "format",
                name: "format",
                location: "query",
                required: false,
              },
            ],
            effect: "read",
          },
          {
            name: "list_drafts",
            description: "List Gmail drafts with pagination.",
            method: "GET",
            path: "/users/me/drafts",
            inputSchema: {
              type: "object",
              properties: {
                maxResults: { type: "integer", minimum: 1, maximum: 100 },
                pageToken: { type: "string" },
                query: { type: "string" },
                includeSpamTrash: { type: "boolean" },
              },
              additionalProperties: false,
            },
            parameters: [
              {
                input: "maxResults",
                name: "maxResults",
                location: "query",
                required: false,
              },
              {
                input: "pageToken",
                name: "pageToken",
                location: "query",
                required: false,
              },
              {
                input: "query",
                name: "q",
                location: "query",
                required: false,
              },
              {
                input: "includeSpamTrash",
                name: "includeSpamTrash",
                location: "query",
                required: false,
              },
            ],
            effect: "read",
          },
          {
            name: "list_labels",
            description: "List the labels in the connected Gmail account.",
            method: "GET",
            path: "/users/me/labels",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            effect: "read",
          },
        ],
      },
      credential: {
        kind: "oauth",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
      tools: {
        allow: [
          "get_message",
          "get_thread",
          "list_drafts",
          "list_labels",
          "search_threads",
        ],
        risk: {
          get_message: { effect: "read", openWorld: true, idempotent: true },
          get_thread: { effect: "read", openWorld: true, idempotent: true },
          list_drafts: { effect: "read", openWorld: true, idempotent: true },
          list_labels: { effect: "read", openWorld: true, idempotent: true },
          search_threads: {
            effect: "read",
            openWorld: true,
            idempotent: true,
          },
        },
      },
      probe: { tool: "list_labels", input: {} },
    },
    { operator: "Google", actionable: false },
  ],
  [
    {
      id: "google-calendar",
      name: "Google Calendar",
      blurb:
        "<b>Calendar</b> — work with calendars and events through Google's official MCP server.",
      tags: ["calendar", "google"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://calendarmcp.googleapis.com/mcp/v1",
      },
      credential: {
        kind: "oauth",
        scopes: [
          "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
          "https://www.googleapis.com/auth/calendar.events.freebusy",
          "https://www.googleapis.com/auth/calendar.events.readonly",
        ],
      },
    },
    { operator: "Google", actionable: false },
  ],
  [
    {
      id: "google-drive",
      name: "Google Drive",
      blurb:
        "<b>Files</b> — find and work with Drive content through Google's official MCP server.",
      tags: ["files", "google"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://drivemcp.googleapis.com/mcp/v1",
      },
      credential: {
        kind: "oauth",
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      },
    },
    { operator: "Google", actionable: false },
  ],
  [
    {
      id: "notion",
      name: "Notion",
      blurb:
        "<b>Knowledge</b> — search and update workspace content through Notion's official MCP server.",
      tags: ["knowledge", "documents"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.notion.com/mcp",
      },
      credential: { kind: "oauth" },
    },
    { operator: "Notion" },
  ],
  [
    {
      id: "stripe",
      name: "Stripe",
      blurb:
        "<b>Payments</b> — inspect and manage Stripe resources through Stripe's official MCP server.",
      tags: ["payments", "finance"],
      transport: {
        kind: "mcp-remote",
        endpoint: "https://mcp.stripe.com",
      },
      credential: { kind: "oauth" },
    },
    { operator: "Stripe" },
  ],
];

export const curatedConnectorManifests: readonly ConnectorManifest[] =
  registryValues.map(([manifest]) => parseConnectorManifest(manifest));

export const connectorRegistryMetadata = new Map(
  registryValues.map(([manifest, metadata]) => [manifest.id, metadata]),
);
