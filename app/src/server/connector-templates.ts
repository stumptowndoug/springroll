import {
  type ConnectorManifest,
  parseConnectorManifest,
} from "@springroll/kernel";
import {
  connectorRegistryMetadata,
  curatedConnectorManifests,
} from "./connector-registry.ts";
import {
  createNeonApiKeyConnectorManifest,
  createNeonOAuthConnectorManifest,
} from "./sources.ts";

export interface ConnectorSetupGuidance {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly docsUrl: string;
}

export interface ConnectorTemplateVariant {
  readonly id: string;
  readonly label: string;
  readonly recommended: boolean;
  readonly actionable: boolean;
  readonly manifest: ConnectorManifest;
  readonly guidance: ConnectorSetupGuidance;
}

export interface ConnectorRegistryTemplate {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly operator: string;
  readonly featured: boolean;
  readonly variants: readonly ConnectorTemplateVariant[];
}

const connectorGuidance: Readonly<Record<string, ConnectorSetupGuidance>> = {
  outlook: {
    summary:
      "Sign in with Microsoft to read Outlook mail and calendars, then add send and event permissions only when needed.",
    steps: [
      "Choose Sign in with Outlook.",
      "Select a Microsoft account and approve read-only mail and calendar access.",
      "Return to Springroll; use Add account for another mailbox.",
      "On the account page, add Send mail and manage events only when you need write access.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/graph/auth-v2-user",
  },
  onedrive: {
    summary:
      "Sign in with Microsoft to search and read OneDrive, then add organize access only when needed.",
    steps: [
      "Choose Sign in with OneDrive.",
      "Select a Microsoft account and approve read-only file access.",
      "Return to Springroll; use Add account for another drive.",
      "On the account page, add Organize files only when you need rename, move, create-folder, or delete access.",
    ],
    docsUrl:
      "https://learn.microsoft.com/en-us/graph/onedrive-concept-overview",
  },
  "microsoft-teams": {
    summary:
      "Sign in with a Microsoft work or school account to read Teams, then add message sending only when needed.",
    steps: [
      "Choose Sign in with Microsoft Teams.",
      "Select a work or school account and review the Teams read permissions.",
      "Ask a tenant admin for consent if your organization requires it.",
      "On the account page, add Send Teams messages only when you need write access.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/graph/teams-concept-overview",
  },
  sharepoint: {
    summary:
      "Sign in with a Microsoft work or school account to search and read SharePoint sites and libraries.",
    steps: [
      "Choose Sign in with SharePoint.",
      "Select a work or school account and review site read access.",
      "Ask a tenant admin for consent if your organization requires it.",
      "On the account page, add Manage SharePoint lists only when you need write access.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/graph/api/resources/sharepoint",
  },
  github: {
    summary:
      "Sign in to GitHub and approve the repositories Springroll may access. The official remote MCP server hosts OAuth; a personal access token is not required.",
    steps: [
      "Choose Sign in with GitHub.",
      "Select the account and review the requested repository access.",
      "Return to Springroll while it discovers GitHub's current tools.",
    ],
    docsUrl:
      "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server",
  },
  jira: {
    summary:
      "Sign in to Atlassian and choose the Jira site Springroll may access.",
    steps: [
      "Choose Sign in with Jira.",
      "Select your Atlassian site and review the requested access.",
      "Return to Springroll while it verifies your Atlassian account.",
    ],
    docsUrl:
      "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
  },
  slack: {
    summary:
      "Sign in to Slack and approve the workspace Springroll may access.",
    steps: [
      "Choose Sign in with Slack.",
      "Select a workspace and review the requested access.",
      "Return to Springroll while it discovers Slack's current tools.",
    ],
    docsUrl: "https://docs.slack.dev/ai/slack-mcp-server/",
  },
  linear: {
    summary: "Sign in to Linear and approve access to your workspace.",
    steps: [
      "Choose Sign in with Linear.",
      "Review the requested workspace access, including create and update if you approve write tools.",
      "Return to Springroll while it verifies the connection.",
    ],
    docsUrl: "https://linear.app/docs/mcp",
  },
  gmail: {
    summary:
      "Sign in to Gmail once and let Springroll search and read mail on demand.",
    steps: [
      "Choose Sign in with Gmail.",
      "Select a Google account and approve read-only Gmail access.",
      "Return to Springroll; use Add account to connect another Gmail address.",
      "On the Gmail account page, choose Add next to Send mail or Drafts and organize when you want those permissions.",
    ],
    docsUrl:
      "https://developers.google.com/workspace/gmail/api/auth/web-server",
  },
  "google-calendar": {
    summary:
      "Sign in to Google once and let Springroll search calendars and manage events on demand.",
    steps: [
      "Choose Sign in with Google Calendar.",
      "Select a Google account and approve read-only calendar access.",
      "Return to Springroll; use Add account to connect another Google calendar identity.",
      "On the calendar account page, choose Add next to Manage events when you want create, update, RSVP, and delete.",
    ],
    docsUrl:
      "https://developers.google.com/workspace/calendar/api/guides/overview",
  },
  "google-drive": {
    summary:
      "Sign in to Google once and let Springroll search and read Drive files on demand.",
    steps: [
      "Choose Sign in with Google Drive.",
      "Select a Google account and approve read-only Drive access.",
      "Return to Springroll; use Add account to connect another Google Drive identity.",
      "On the Drive account page, choose Add next to Create and organize when you want to create files or trash items.",
    ],
    docsUrl:
      "https://developers.google.com/workspace/drive/api/guides/about-sdk",
  },
  notion: {
    summary: "Sign in to Notion and choose the workspace to connect.",
    steps: [
      "Choose Sign in with Notion.",
      "Select a workspace and review the requested access.",
      "Return to Springroll while it discovers Notion's current tools.",
    ],
    docsUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
  },
  stripe: {
    summary:
      "Sign in to Stripe, choose sandbox or live access, and keep consequential tools behind confirmation.",
    steps: [
      "Choose Sign in with Stripe.",
      "Review the account, mode, and permissions on Stripe's consent screen.",
      "Return to Springroll and review discovered write-capable tools before use.",
    ],
    docsUrl: "https://docs.stripe.com/mcp",
  },
};

const neonOAuth = parseConnectorManifest(createNeonOAuthConnectorManifest());
const neonApiKey = parseConnectorManifest(createNeonApiKeyConnectorManifest());

const connectorAliases: Readonly<Record<string, readonly string[]>> = {
  outlook: ["outlook", "microsoft mail", "office 365 mail"],
  onedrive: ["onedrive", "one drive", "microsoft files"],
  "microsoft-teams": ["microsoft teams"],
  sharepoint: ["sharepoint", "share point", "microsoft sites"],
  github: ["github", "git hub"],
  jira: ["jira", "atlassian", "confluence"],
  slack: ["slack"],
  linear: ["linear"],
  gmail: ["gmail", "google mail"],
  "google-calendar": ["google calendar"],
  "google-drive": ["google drive"],
  notion: ["notion"],
  stripe: ["stripe"],
};

const featuredConnectorIds = new Set([
  "outlook",
  "onedrive",
  "microsoft-teams",
  "sharepoint",
  "github",
  "jira",
  "slack",
  "linear",
  "gmail",
  "google-calendar",
  "google-drive",
  "notion",
  "stripe",
]);

export const connectorRegistryTemplates: readonly ConnectorRegistryTemplate[] =
  [
    {
      id: "neon",
      name: "Neon",
      aliases: ["neon"],
      operator: "Neon",
      featured: true,
      variants: [
        {
          id: "oauth",
          label: "Sign in with Neon",
          recommended: true,
          actionable: true,
          manifest: neonOAuth,
          guidance: {
            summary:
              "Sign in to Neon. No API key needs to be copied into Springroll.",
            steps: [
              "Choose Sign in with Neon.",
              "Approve access in Neon.",
              "Return to Springroll while it discovers Neon's current tools.",
            ],
            docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
          },
        },
        {
          id: "api-key",
          label: "Use one API key",
          recommended: false,
          actionable: true,
          manifest: neonApiKey,
          guidance: {
            summary:
              "Create one Neon API key and paste it into Springroll's secure field—not the chat.",
            steps: [
              "Open Neon API keys.",
              "Create and copy one key.",
              "Paste it into the secure field so Springroll can discover Neon's current tools.",
            ],
            docsUrl: "https://console.neon.tech/app/settings/api-keys",
          },
        },
      ],
    },
    ...curatedConnectorManifests.map((manifest): ConnectorRegistryTemplate => {
      const metadata = connectorRegistryMetadata.get(manifest.id);
      if (!metadata)
        throw new Error(`Missing registry metadata for ${manifest.id}`);
      const guidance = connectorGuidance[manifest.id];
      if (!guidance)
        throw new Error(`Missing setup guidance for ${manifest.id}`);
      return {
        id: manifest.id,
        name: manifest.name,
        aliases: connectorAliases[manifest.id] ?? [manifest.name.toLowerCase()],
        operator: metadata.operator,
        featured: featuredConnectorIds.has(manifest.id),
        variants: [
          {
            id: manifest.credential.kind === "api-key" ? "api-key" : "oauth",
            label:
              manifest.credential.kind === "api-key"
                ? `Use a ${manifest.name} token`
                : `Sign in with ${manifest.name}`,
            recommended: true,
            actionable: metadata.actionable ?? true,
            manifest,
            guidance,
          },
        ],
      };
    }),
  ];

export const connectorTemplateMetadata = new Map(
  connectorRegistryTemplates.map((template) => {
    const recommendedVariant =
      template.variants.find(
        (variant) => variant.recommended && variant.actionable,
      ) ?? template.variants.find((variant) => variant.actionable);
    return [
      template.id,
      {
        operator: template.operator,
        featured: template.featured,
        actionable: template.variants.some((variant) => variant.actionable),
        setupVariantId: recommendedVariant?.id,
        oauthReady: template.variants.some(
          (variant) =>
            variant.manifest.credential.kind === "oauth" && variant.actionable,
        ),
      },
    ] as const;
  }),
);

export function connectorTemplate(
  id: string,
): ConnectorRegistryTemplate | undefined {
  return connectorRegistryTemplates.find((template) => template.id === id);
}

export function matchConnectorTemplate(
  sentence: string,
): ConnectorRegistryTemplate | undefined {
  const normalized = sentence
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // Category words must never choose a provider. Ambiguous multi-service
  // requests go through research rather than picking by registry order.
  const matches = connectorRegistryTemplates.filter((template) =>
    template.aliases.some((alias) => ` ${normalized} `.includes(` ${alias} `)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
