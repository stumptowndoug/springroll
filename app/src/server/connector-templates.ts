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

const oauthGuidance: Readonly<Record<string, ConnectorSetupGuidance>> = {
  gmail: {
    summary:
      "Sign in with Google and approve only the access Springroll requests.",
    steps: [
      "Choose Sign in with Google.",
      "Review the requested Gmail access.",
      "Return to Springroll while it verifies a read-only probe.",
    ],
    docsUrl: "https://developers.google.com/workspace/gmail/api/auth/scopes",
  },
  github: {
    summary:
      "Sign in to GitHub; Springroll uses GitHub's hosted read-only MCP endpoint.",
    steps: [
      "Choose Sign in with GitHub.",
      "Review the GitHub authorization.",
      "Return to Springroll while it verifies your account.",
    ],
    docsUrl:
      "https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-chat-with-mcp",
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
  notion: {
    summary:
      "Sign in to Notion and choose the workspace pages Springroll may use.",
    steps: [
      "Choose Sign in with Notion.",
      "Select the workspace and allowed pages.",
      "Return to Springroll while it verifies the connection.",
    ],
    docsUrl: "https://developers.notion.com/docs/get-started-with-mcp",
  },
  slack: {
    summary: "Sign in to Slack and choose the workspace Springroll may search.",
    steps: [
      "Choose Sign in with Slack.",
      "Review the workspace access.",
      "Return to Springroll while it verifies the connection.",
    ],
    docsUrl: "https://docs.slack.dev/ai/slack-mcp-server/",
  },
  linear: {
    summary: "Sign in to Linear and approve access to your workspace.",
    steps: [
      "Choose Sign in with Linear.",
      "Review the requested workspace access.",
      "Return to Springroll while it verifies the connection.",
    ],
    docsUrl: "https://linear.app/docs/mcp",
  },
};

const neonOAuth = parseConnectorManifest(createNeonOAuthConnectorManifest());
const neonApiKey = parseConnectorManifest(createNeonApiKeyConnectorManifest());

const connectorAliases: Readonly<Record<string, readonly string[]>> = {
  gmail: ["gmail", "google mail", "email"],
  github: ["github", "git hub", "repository", "pull request"],
  jira: ["jira", "atlassian", "jql", "work item"],
  notion: ["notion", "wiki", "workspace pages"],
  slack: ["slack", "channels", "workspace messages"],
  linear: ["linear", "issues", "project tracking"],
};

const featuredConnectorIds = new Set(["github", "jira", "notion"]);

export const connectorRegistryTemplates: readonly ConnectorRegistryTemplate[] =
  [
    {
      id: "neon",
      name: "Neon",
      aliases: ["neon", "postgres", "postgresql", "database"],
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
              "Return to Springroll while it verifies list_projects.",
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
              "Paste it into the secure field so Springroll can verify list_projects.",
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
      const guidance = oauthGuidance[manifest.id];
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
            id: "oauth",
            label: `Sign in with ${manifest.name}`,
            recommended: true,
            actionable: metadata.oauthReady,
            manifest,
            guidance,
          },
        ],
      };
    }),
  ];

export const connectorTemplateMetadata = new Map(
  connectorRegistryTemplates.map((template) => [
    template.id,
    {
      operator: template.operator,
      featured: template.featured,
      actionable: template.variants.some((variant) => variant.actionable),
      oauthReady: template.variants.some(
        (variant) =>
          variant.manifest.credential.kind === "oauth" && variant.actionable,
      ),
    },
  ]),
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
  return connectorRegistryTemplates.find((template) =>
    template.aliases.some((alias) => ` ${normalized} `.includes(` ${alias} `)),
  );
}
