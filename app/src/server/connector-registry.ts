import {
  type ConnectorManifest,
  parseConnectorManifest,
} from "@springroll/kernel";

export interface ConnectorRegistryMetadata {
  readonly operator: string;
  readonly actionable?: boolean;
}

const gmailComposeInputSchema = {
  type: "object",
  properties: {
    to: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    cc: { type: "string" },
    bcc: { type: "string" },
    threadId: { type: "string" },
    inReplyTo: { type: "string" },
  },
  required: ["to", "subject", "body"],
  additionalProperties: false,
} as const;

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
      credential: {
        kind: "oauth",
        accountIdentity: {
          endpoint: "https://api.github.com/user",
          field: "login",
        },
      },
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
          {
            name: "create_draft",
            description:
              "Create a Gmail draft. Review it in Gmail or send it later.",
            method: "POST",
            path: "/users/me/drafts",
            inputSchema: gmailComposeInputSchema,
            bodyEncoding: "gmail-rfc822-draft",
            effect: "write",
            permissionSet: "organize",
          },
          {
            name: "trash_message",
            description: "Move a Gmail message to trash.",
            method: "POST",
            path: "/users/me/messages/{messageId}/trash",
            inputSchema: {
              type: "object",
              properties: { messageId: { type: "string" } },
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
            ],
            effect: "destructive",
            permissionSet: "organize",
          },
          {
            name: "send_message",
            description:
              "Send an email as the connected Gmail account. Confirm with the user before sending.",
            method: "POST",
            path: "/users/me/messages/send",
            inputSchema: gmailComposeInputSchema,
            bodyEncoding: "gmail-rfc822",
            effect: "write",
            permissionSet: "send",
          },
        ],
      },
      credential: {
        kind: "oauth",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        accountIdentity: {
          endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          field: "emailAddress",
        },
        permissionSets: [
          {
            id: "read",
            label: "Read mail",
            summary: "Search and read messages, threads, drafts, and labels.",
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
            required: true,
          },
          {
            id: "organize",
            label: "Drafts and organize",
            summary: "Create drafts, trash messages, and change labels.",
            scopes: ["https://www.googleapis.com/auth/gmail.modify"],
            supersedes: ["read"],
          },
          {
            id: "send",
            label: "Send mail",
            summary: "Send, reply, and forward as this account.",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
      },
      tools: {
        allow: [
          "create_draft",
          "get_message",
          "get_thread",
          "list_drafts",
          "list_labels",
          "search_threads",
          "send_message",
          "trash_message",
        ],
        risk: {
          create_draft: {
            effect: "write",
            openWorld: true,
            idempotent: false,
          },
          get_message: { effect: "read", openWorld: true, idempotent: true },
          get_thread: { effect: "read", openWorld: true, idempotent: true },
          list_drafts: { effect: "read", openWorld: true, idempotent: true },
          list_labels: { effect: "read", openWorld: true, idempotent: true },
          search_threads: {
            effect: "read",
            openWorld: true,
            idempotent: true,
          },
          send_message: {
            effect: "write",
            openWorld: true,
            idempotent: false,
          },
          trash_message: {
            effect: "destructive",
            openWorld: true,
            idempotent: false,
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
