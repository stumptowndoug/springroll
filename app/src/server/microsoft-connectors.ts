import {
  type ConnectorManifest,
  parseConnectorManifest,
} from "@springroll/kernel";

const graphBaseUrl = "https://graph.microsoft.com/v1.0";
const graphAccountIdentity = {
  endpoint: "https://graph.microsoft.com/v1.0/me?$select=userPrincipalName",
  field: "userPrincipalName",
} as const;
const graphIdentityScopes = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
];

const emptyInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const jsonObjectSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const outlookManifest = {
  id: "outlook",
  name: "Outlook Mail & Calendar",
  blurb:
    "<b>Email and calendar</b> — search mail, manage events, and send through Microsoft Graph.",
  tags: ["email", "calendar", "microsoft"],
  transport: {
    kind: "http-api",
    baseUrl: graphBaseUrl,
    operations: [
      {
        name: "list_messages",
        description:
          "List Outlook messages with optional Microsoft Graph filtering and ordering.",
        method: "GET",
        path: "/me/messages",
        inputSchema: {
          type: "object",
          properties: {
            top: { type: "integer", minimum: 1, maximum: 100 },
            filter: { type: "string" },
            orderBy: { type: "string" },
          },
          additionalProperties: false,
        },
        parameters: [
          { input: "top", name: "$top", location: "query" },
          { input: "filter", name: "$filter", location: "query" },
          { input: "orderBy", name: "$orderby", location: "query" },
        ],
        fixedQuery: {
          $select:
            "id,subject,sender,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview,webLink",
        },
        effect: "read",
      },
      {
        name: "get_message",
        description:
          "Read one Outlook message, including its body and recipient metadata.",
        method: "GET",
        path: "/me/messages/{messageId}",
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
        effect: "read",
      },
      {
        name: "list_calendar_events",
        description:
          "List Outlook calendar events in a required ISO 8601 time range.",
        method: "GET",
        path: "/me/calendarView",
        inputSchema: {
          type: "object",
          properties: {
            startDateTime: { type: "string" },
            endDateTime: { type: "string" },
            top: { type: "integer", minimum: 1, maximum: 100 },
          },
          required: ["startDateTime", "endDateTime"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "startDateTime",
            name: "startDateTime",
            location: "query",
            required: true,
          },
          {
            input: "endDateTime",
            name: "endDateTime",
            location: "query",
            required: true,
          },
          { input: "top", name: "$top", location: "query" },
        ],
        fixedQuery: {
          $select:
            "id,subject,start,end,location,organizer,attendees,isCancelled,webLink",
          $orderby: "start/dateTime",
        },
        effect: "read",
      },
      {
        name: "send_mail",
        description:
          "Send an Outlook email. Confirm the recipients, subject, and body before sending.",
        method: "POST",
        path: "/me/sendMail",
        inputSchema: {
          type: "object",
          properties: {
            message: jsonObjectSchema,
            saveToSentItems: { type: "boolean" },
          },
          required: ["message"],
          additionalProperties: false,
        },
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "create_event",
        description:
          "Create an Outlook calendar event. Confirm the time and attendees before creating it.",
        method: "POST",
        path: "/me/events",
        inputSchema: {
          type: "object",
          properties: { event: jsonObjectSchema },
          required: ["event"],
          additionalProperties: false,
        },
        bodyInput: "event",
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "update_event",
        description:
          "Update an Outlook calendar event. Confirm meaningful attendee or time changes first.",
        method: "PATCH",
        path: "/me/events/{eventId}",
        inputSchema: {
          type: "object",
          properties: {
            eventId: { type: "string" },
            event: jsonObjectSchema,
          },
          required: ["eventId", "event"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "eventId",
            name: "eventId",
            location: "path",
            required: true,
          },
        ],
        bodyInput: "event",
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "delete_event",
        description:
          "Delete an Outlook calendar event. Always confirm before deleting it.",
        method: "DELETE",
        path: "/me/events/{eventId}",
        inputSchema: {
          type: "object",
          properties: { eventId: { type: "string" } },
          required: ["eventId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "eventId",
            name: "eventId",
            location: "path",
            required: true,
          },
        ],
        effect: "destructive",
        permissionSet: "write",
      },
    ],
  },
  credential: {
    kind: "oauth",
    accountIdentity: graphAccountIdentity,
    permissionSets: [
      {
        id: "read",
        label: "Read mail and calendar",
        summary: "Read Outlook messages and calendar events.",
        scopes: [...graphIdentityScopes, "Mail.Read", "Calendars.Read"],
        required: true,
      },
      {
        id: "write",
        label: "Send mail and manage events",
        summary: "Send mail and create, update, or delete calendar events.",
        scopes: ["Mail.Send", "Calendars.ReadWrite"],
      },
    ],
  },
  tools: {
    allow: [
      "list_messages",
      "get_message",
      "list_calendar_events",
      "send_mail",
      "create_event",
      "update_event",
      "delete_event",
    ],
    risk: {
      delete_event: {
        effect: "destructive",
        openWorld: true,
        idempotent: false,
      },
      send_mail: { effect: "write", openWorld: true, idempotent: false },
    },
  },
  probe: { tool: "list_messages", input: { top: 1 } },
} as const;

const oneDriveManifest = {
  id: "onedrive",
  name: "OneDrive",
  blurb:
    "<b>Files</b> — search and organize personal and shared Microsoft files through Graph.",
  tags: ["files", "microsoft"],
  transport: {
    kind: "http-api",
    baseUrl: graphBaseUrl,
    operations: [
      {
        name: "list_root_items",
        description:
          "List files and folders at the root of the connected OneDrive.",
        method: "GET",
        path: "/me/drive/root/children",
        inputSchema: {
          type: "object",
          properties: { top: { type: "integer", minimum: 1, maximum: 200 } },
          additionalProperties: false,
        },
        parameters: [{ input: "top", name: "$top", location: "query" }],
        fixedQuery: {
          $select:
            "id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference",
        },
        effect: "read",
      },
      {
        name: "search_files",
        description:
          "Search the connected OneDrive for files and folders by text.",
        method: "GET",
        path: "/me/drive/root/search(q='{query}')",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            top: { type: "integer", minimum: 1, maximum: 200 },
          },
          required: ["query"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "query",
            name: "query",
            location: "path",
            required: true,
          },
          { input: "top", name: "$top", location: "query" },
        ],
        effect: "read",
      },
      {
        name: "get_item",
        description:
          "Get OneDrive file or folder metadata, including the temporary download URL when available.",
        method: "GET",
        path: "/me/drive/items/{itemId}",
        inputSchema: {
          type: "object",
          properties: { itemId: { type: "string" } },
          required: ["itemId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "itemId",
            name: "itemId",
            location: "path",
            required: true,
          },
        ],
        effect: "read",
      },
      {
        name: "list_children",
        description: "List files and folders inside a OneDrive folder.",
        method: "GET",
        path: "/me/drive/items/{itemId}/children",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            top: { type: "integer", minimum: 1, maximum: 200 },
          },
          required: ["itemId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "itemId",
            name: "itemId",
            location: "path",
            required: true,
          },
          { input: "top", name: "$top", location: "query" },
        ],
        effect: "read",
      },
      {
        name: "create_folder",
        description:
          "Create a folder in OneDrive. Confirm the location and name first.",
        method: "POST",
        path: "/me/drive/items/{parentId}/children",
        inputSchema: {
          type: "object",
          properties: {
            parentId: { type: "string" },
            item: jsonObjectSchema,
          },
          required: ["parentId", "item"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "parentId",
            name: "parentId",
            location: "path",
            required: true,
          },
        ],
        bodyInput: "item",
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "update_item",
        description:
          "Rename or move a OneDrive item. Confirm consequential changes first.",
        method: "PATCH",
        path: "/me/drive/items/{itemId}",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            item: jsonObjectSchema,
          },
          required: ["itemId", "item"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "itemId",
            name: "itemId",
            location: "path",
            required: true,
          },
        ],
        bodyInput: "item",
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "delete_item",
        description:
          "Delete a OneDrive file or folder. Always confirm before deleting it.",
        method: "DELETE",
        path: "/me/drive/items/{itemId}",
        inputSchema: {
          type: "object",
          properties: { itemId: { type: "string" } },
          required: ["itemId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "itemId",
            name: "itemId",
            location: "path",
            required: true,
          },
        ],
        effect: "destructive",
        permissionSet: "write",
      },
    ],
  },
  credential: {
    kind: "oauth",
    accountIdentity: graphAccountIdentity,
    permissionSets: [
      {
        id: "read",
        label: "Read files",
        summary: "Search and read files and folders in this OneDrive.",
        scopes: [...graphIdentityScopes, "Files.Read"],
        required: true,
      },
      {
        id: "write",
        label: "Organize files",
        summary: "Create folders, rename or move items, and delete items.",
        scopes: ["Files.ReadWrite"],
        supersedes: ["read"],
      },
    ],
  },
  tools: {
    allow: [
      "list_root_items",
      "search_files",
      "get_item",
      "list_children",
      "create_folder",
      "update_item",
      "delete_item",
    ],
    risk: {
      delete_item: {
        effect: "destructive",
        openWorld: true,
        idempotent: false,
      },
    },
  },
  probe: { tool: "list_root_items", input: { top: 1 } },
} as const;

const teamsManifest = {
  id: "microsoft-teams",
  name: "Microsoft Teams",
  blurb:
    "<b>Messages</b> — read chats and channels and send messages through Microsoft Graph.",
  tags: ["messaging", "meetings", "microsoft"],
  transport: {
    kind: "http-api",
    baseUrl: graphBaseUrl,
    operations: [
      {
        name: "list_chats",
        description:
          "List chats for the connected Microsoft work or school account.",
        method: "GET",
        path: "/me/chats",
        inputSchema: {
          type: "object",
          properties: { top: { type: "integer", minimum: 1, maximum: 50 } },
          additionalProperties: false,
        },
        parameters: [{ input: "top", name: "$top", location: "query" }],
        effect: "read",
      },
      {
        name: "list_chat_messages",
        description: "List messages in a Microsoft Teams chat.",
        method: "GET",
        path: "/chats/{chatId}/messages",
        inputSchema: {
          type: "object",
          properties: {
            chatId: { type: "string" },
            top: { type: "integer", minimum: 1, maximum: 50 },
          },
          required: ["chatId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "chatId",
            name: "chatId",
            location: "path",
            required: true,
          },
          { input: "top", name: "$top", location: "query" },
        ],
        effect: "read",
      },
      {
        name: "list_joined_teams",
        description: "List Microsoft Teams joined by the connected account.",
        method: "GET",
        path: "/me/joinedTeams",
        inputSchema: emptyInputSchema,
        effect: "read",
        permissionSet: "channels",
      },
      {
        name: "list_channels",
        description: "List channels in a Microsoft Team.",
        method: "GET",
        path: "/teams/{teamId}/channels",
        inputSchema: {
          type: "object",
          properties: { teamId: { type: "string" } },
          required: ["teamId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "teamId",
            name: "teamId",
            location: "path",
            required: true,
          },
        ],
        effect: "read",
        permissionSet: "channels",
      },
      {
        name: "list_channel_messages",
        description: "List root messages in a Microsoft Teams channel.",
        method: "GET",
        path: "/teams/{teamId}/channels/{channelId}/messages",
        inputSchema: {
          type: "object",
          properties: {
            teamId: { type: "string" },
            channelId: { type: "string" },
            top: { type: "integer", minimum: 1, maximum: 50 },
          },
          required: ["teamId", "channelId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "teamId",
            name: "teamId",
            location: "path",
            required: true,
          },
          {
            input: "channelId",
            name: "channelId",
            location: "path",
            required: true,
          },
          { input: "top", name: "$top", location: "query" },
        ],
        effect: "read",
        permissionSet: "channels",
      },
      {
        name: "send_chat_message",
        description:
          "Send a message to a Teams chat. Confirm the destination and message first.",
        method: "POST",
        path: "/chats/{chatId}/messages",
        inputSchema: {
          type: "object",
          properties: {
            chatId: { type: "string" },
            message: jsonObjectSchema,
          },
          required: ["chatId", "message"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "chatId",
            name: "chatId",
            location: "path",
            required: true,
          },
        ],
        bodyInput: "message",
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "send_channel_message",
        description:
          "Send a root message to a Teams channel. Confirm the destination and message first.",
        method: "POST",
        path: "/teams/{teamId}/channels/{channelId}/messages",
        inputSchema: {
          type: "object",
          properties: {
            teamId: { type: "string" },
            channelId: { type: "string" },
            message: jsonObjectSchema,
          },
          required: ["teamId", "channelId", "message"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "teamId",
            name: "teamId",
            location: "path",
            required: true,
          },
          {
            input: "channelId",
            name: "channelId",
            location: "path",
            required: true,
          },
        ],
        bodyInput: "message",
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
    ],
  },
  credential: {
    kind: "oauth",
    accountIdentity: graphAccountIdentity,
    permissionSets: [
      {
        id: "read",
        label: "Read Teams",
        summary: "Read the connected account's Teams chats.",
        scopes: [...graphIdentityScopes, "Chat.Read"],
        required: true,
      },
      {
        id: "channels",
        label: "Read channels",
        summary: "Read joined teams, channels, and channel messages.",
        scopes: [
          "Team.ReadBasic.All",
          "Channel.ReadBasic.All",
          "ChannelMessage.Read.All",
        ],
      },
      {
        id: "write",
        label: "Send Teams messages",
        summary: "Send messages to chats and channels.",
        scopes: ["ChatMessage.Send", "ChannelMessage.Send"],
      },
    ],
  },
  tools: {
    allow: [
      "list_chats",
      "list_chat_messages",
      "list_joined_teams",
      "list_channels",
      "list_channel_messages",
      "send_chat_message",
      "send_channel_message",
    ],
    risk: {
      send_chat_message: {
        effect: "write",
        openWorld: true,
        idempotent: false,
      },
      send_channel_message: {
        effect: "write",
        openWorld: true,
        idempotent: false,
      },
    },
  },
  probe: { tool: "list_chats", input: { top: 1 } },
} as const;

const sharePointManifest = {
  id: "sharepoint",
  name: "SharePoint",
  blurb:
    "<b>Knowledge</b> — search sites, libraries, lists, and pages through Microsoft Graph.",
  tags: ["files", "knowledge", "microsoft"],
  transport: {
    kind: "http-api",
    baseUrl: graphBaseUrl,
    operations: [
      {
        name: "search_sites",
        description: "Search SharePoint sites by name or keyword.",
        method: "GET",
        path: "/sites",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "query",
            name: "search",
            location: "query",
            required: true,
          },
        ],
        effect: "read",
      },
      {
        name: "get_site",
        description: "Get SharePoint site metadata by Microsoft Graph site ID.",
        method: "GET",
        path: "/sites/{siteId}",
        inputSchema: {
          type: "object",
          properties: { siteId: { type: "string" } },
          required: ["siteId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "siteId",
            name: "siteId",
            location: "path",
            required: true,
          },
        ],
        effect: "read",
      },
      {
        name: "list_site_lists",
        description: "List lists and document libraries in a SharePoint site.",
        method: "GET",
        path: "/sites/{siteId}/lists",
        inputSchema: {
          type: "object",
          properties: { siteId: { type: "string" } },
          required: ["siteId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "siteId",
            name: "siteId",
            location: "path",
            required: true,
          },
        ],
        effect: "read",
      },
      {
        name: "list_list_items",
        description: "List SharePoint list items with their fields.",
        method: "GET",
        path: "/sites/{siteId}/lists/{listId}/items",
        inputSchema: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            listId: { type: "string" },
            top: { type: "integer", minimum: 1, maximum: 200 },
          },
          required: ["siteId", "listId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "siteId",
            name: "siteId",
            location: "path",
            required: true,
          },
          {
            input: "listId",
            name: "listId",
            location: "path",
            required: true,
          },
          { input: "top", name: "$top", location: "query" },
        ],
        fixedQuery: { $expand: "fields" },
        effect: "read",
      },
      {
        name: "list_library_items",
        description:
          "List files and folders at the root of a SharePoint site's default library.",
        method: "GET",
        path: "/sites/{siteId}/drive/root/children",
        inputSchema: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            top: { type: "integer", minimum: 1, maximum: 200 },
          },
          required: ["siteId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "siteId",
            name: "siteId",
            location: "path",
            required: true,
          },
          { input: "top", name: "$top", location: "query" },
        ],
        effect: "read",
      },
      {
        name: "create_list_item",
        description:
          "Create a SharePoint list item. Confirm the target list and field values first.",
        method: "POST",
        path: "/sites/{siteId}/lists/{listId}/items",
        inputSchema: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            listId: { type: "string" },
            fields: jsonObjectSchema,
          },
          required: ["siteId", "listId", "fields"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "siteId",
            name: "siteId",
            location: "path",
            required: true,
          },
          {
            input: "listId",
            name: "listId",
            location: "path",
            required: true,
          },
        ],
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "update_list_item",
        description:
          "Update SharePoint list item fields. Confirm consequential changes first.",
        method: "PATCH",
        path: "/sites/{siteId}/lists/{listId}/items/{itemId}/fields",
        inputSchema: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            listId: { type: "string" },
            itemId: { type: "string" },
            fields: jsonObjectSchema,
          },
          required: ["siteId", "listId", "itemId", "fields"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "siteId",
            name: "siteId",
            location: "path",
            required: true,
          },
          {
            input: "listId",
            name: "listId",
            location: "path",
            required: true,
          },
          {
            input: "itemId",
            name: "itemId",
            location: "path",
            required: true,
          },
        ],
        bodyInput: "fields",
        bodyEncoding: "json",
        effect: "write",
        permissionSet: "write",
      },
      {
        name: "delete_list_item",
        description:
          "Delete a SharePoint list item. Always confirm before deleting it.",
        method: "DELETE",
        path: "/sites/{siteId}/lists/{listId}/items/{itemId}",
        inputSchema: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            listId: { type: "string" },
            itemId: { type: "string" },
          },
          required: ["siteId", "listId", "itemId"],
          additionalProperties: false,
        },
        parameters: [
          {
            input: "siteId",
            name: "siteId",
            location: "path",
            required: true,
          },
          {
            input: "listId",
            name: "listId",
            location: "path",
            required: true,
          },
          {
            input: "itemId",
            name: "itemId",
            location: "path",
            required: true,
          },
        ],
        effect: "destructive",
        permissionSet: "write",
      },
    ],
  },
  credential: {
    kind: "oauth",
    accountIdentity: graphAccountIdentity,
    permissionSets: [
      {
        id: "read",
        label: "Read SharePoint",
        summary: "Search sites and read libraries, lists, and pages.",
        scopes: [...graphIdentityScopes, "Sites.Read.All"],
        required: true,
      },
      {
        id: "write",
        label: "Manage SharePoint lists",
        summary: "Create, update, and delete SharePoint list items.",
        scopes: ["Sites.ReadWrite.All"],
        supersedes: ["read"],
      },
    ],
  },
  tools: {
    allow: [
      "search_sites",
      "get_site",
      "list_site_lists",
      "list_list_items",
      "list_library_items",
      "create_list_item",
      "update_list_item",
      "delete_list_item",
    ],
    risk: {
      delete_list_item: {
        effect: "destructive",
        openWorld: true,
        idempotent: false,
      },
    },
  },
  probe: { tool: "search_sites", input: { query: "Springroll" } },
} as const;

export const microsoftConnectorManifests: readonly ConnectorManifest[] = [
  outlookManifest,
  oneDriveManifest,
  teamsManifest,
  sharePointManifest,
].map((manifest) => parseConnectorManifest(manifest));
