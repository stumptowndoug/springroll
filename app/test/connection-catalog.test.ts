import { describe, expect, test } from "bun:test";
import {
  connectionCatalogTags,
  filterIntegrationCatalog,
  installedIntegrationAccounts,
  oneClickIntegrationState,
  oneClickIntegrations,
  standardIntegrationCatalog,
  visibleIntegrationCatalog,
} from "../src/client/connection-catalog.ts";
import {
  type ConnectionCardDto,
  connectionAccountLabel,
  connectionCardTitle,
  connectorProviderId,
} from "../src/shared.ts";

const cards: readonly ConnectionCardDto[] = [
  {
    id: "web-search",
    name: "Exa",
    description: "Search and read the web",
    category: "web-search",
    status: "connected",
    tags: ["search", "web"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages and comments",
    category: "connector",
    status: "connected",
    tags: ["workspace"],
  },
  {
    id: "firebase",
    name: "Firebase",
    description: "Local backend tools",
    category: "connector",
    status: "not_connected",
    installed: true,
    tags: ["database"],
  },
  {
    id: "planned-search",
    name: "Planned Search",
    description: "Not available",
    category: "web-search",
    status: "coming_soon",
    tags: ["search"],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Email",
    category: "connector",
    status: "coming_soon",
    featured: true,
    actionable: false,
    tags: ["email"],
  },
  {
    id: "notion-work",
    manifestId: "notion",
    providerName: "Notion",
    name: "Acme workspace",
    description: "Pages and comments",
    category: "connector",
    status: "connected",
    installed: true,
    featured: true,
    tags: ["workspace"],
  },
  {
    id: "image-generation",
    name: "Image generation",
    description: "Generate images with a native tool",
    category: "capability",
    status: "connected",
    installed: true,
    tags: ["images"],
  },
];

describe("unified integration catalog", () => {
  test("includes usable and installed connectors", () => {
    const visible = visibleIntegrationCatalog(cards);
    expect(visible.map((card) => card.id)).toEqual([
      "notion",
      "firebase",
      "gmail",
      "notion-work",
    ]);
    expect(connectionCatalogTags(visible)).toEqual([
      "database",
      "email",
      "workspace",
    ]);
  });

  test("filters by tag, status, and searchable metadata", () => {
    const visible = visibleIntegrationCatalog(cards);
    expect(
      filterIntegrationCatalog(visible, {
        query: "",
        status: "all",
        tag: "workspace",
      }).map((card) => card.id),
    ).toEqual(["notion", "notion-work"]);
    expect(
      filterIntegrationCatalog(visible, {
        query: "backend",
        status: "disconnected",
      }).map((card) => card.id),
    ).toEqual(["firebase"]);
  });

  test("separates account instances from a provider-ranked standard catalog", () => {
    const visible = visibleIntegrationCatalog(cards);
    expect(
      installedIntegrationAccounts(visible).map((card) => card.id),
    ).toEqual(["notion-work", "firebase"]);
    expect(standardIntegrationCatalog(visible).map((card) => card.id)).toEqual([
      "gmail",
      "notion-work",
    ]);
  });

  test("shows implemented one-click connectors that still need operator setup", () => {
    const visible = visibleIntegrationCatalog([
      ...cards,
      {
        id: "github",
        name: "GitHub",
        description: "Repos",
        category: "connector",
        status: "not_connected",
        featured: true,
        credentialKind: "oauth",
        tags: ["code"],
      },
      {
        id: "outlook",
        name: "Outlook Mail & Calendar",
        description: "Mail",
        category: "connector",
        status: "coming_soon",
        featured: true,
        credentialKind: "oauth",
        oauthReady: false,
        tags: ["email"],
      },
      {
        id: "salesforce",
        name: "Salesforce",
        description: "Planned CRM integration",
        category: "connector",
        status: "coming_soon",
        featured: true,
        credentialKind: "oauth",
        tags: ["crm"],
      },
    ]);
    const oneClick = oneClickIntegrations(visible);
    expect(oneClick.map((card) => card.id)).toEqual(["outlook", "github"]);
    const outlook = oneClick.find((card) => card.id === "outlook");
    const github = oneClick.find((card) => card.id === "github");
    const salesforce = visible.find((card) => card.id === "salesforce");
    expect(outlook).toBeDefined();
    expect(github).toBeDefined();
    expect(salesforce).toBeDefined();
    if (!outlook || !github || !salesforce) throw new Error("Missing fixture");
    expect(oneClickIntegrationState(outlook)).toBe("setup_required");
    expect(oneClickIntegrationState(github)).toBe("ready");
    expect(oneClickIntegrationState(salesforce)).toBeUndefined();
  });

  test("keeps installed OAuth providers in one-click and marks their state", () => {
    expect(connectorProviderId({ id: "gmail-default" })).toBe("gmail-default");
    expect(
      connectorProviderId({ id: "gmail-default", manifestId: "gmail" }),
    ).toBe("gmail");
    const visible = visibleIntegrationCatalog([
      ...cards,
      {
        id: "gmail-default",
        manifestId: "gmail",
        providerName: "Gmail",
        name: "Gmail · work@example.com",
        description: "Email",
        category: "connector",
        status: "connected",
        installed: true,
        featured: true,
        credentialKind: "oauth",
        canAddAnother: true,
        oauthReady: true,
        setupVariantId: "oauth",
        tags: ["email"],
      },
      {
        id: "github",
        name: "GitHub",
        description: "Repos",
        category: "connector",
        status: "not_connected",
        featured: true,
        credentialKind: "oauth",
        tags: ["code"],
      },
    ]);
    expect(oneClickIntegrations(visible).map((card) => card.id)).toEqual([
      "gmail-default",
      "github",
    ]);
    const gmail = oneClickIntegrations(visible).find(
      (card) => card.id === "gmail-default",
    );
    expect(gmail).toBeDefined();
    if (!gmail) throw new Error("Expected Gmail in the one-click row");
    expect(oneClickIntegrationState(gmail)).toBe("connected");
    expect(
      installedIntegrationAccounts(visible).map((card) => card.id),
    ).toContain("gmail-default");
  });

  test("prefers a healthy account when a one-click provider has multiple accounts", () => {
    const visible = visibleIntegrationCatalog([
      {
        id: "gmail-work",
        manifestId: "gmail",
        providerName: "Gmail",
        name: "Gmail · work@example.com",
        description: "Email",
        category: "connector",
        status: "not_connected",
        installed: true,
        featured: true,
        credentialKind: "oauth",
        oauthReady: true,
      },
      {
        id: "gmail-personal",
        manifestId: "gmail",
        providerName: "Gmail",
        name: "Gmail · personal@example.com",
        description: "Email",
        category: "connector",
        status: "connected",
        installed: true,
        featured: true,
        credentialKind: "oauth",
        oauthReady: true,
      },
    ]);

    const oneClick = oneClickIntegrations(visible);
    expect(oneClick.map((card) => card.id)).toEqual(["gmail-personal"]);
    const gmail = oneClick[0];
    expect(gmail).toBeDefined();
    if (!gmail) throw new Error("Expected Gmail in the one-click row");
    expect(oneClickIntegrationState(gmail)).toBe("connected");
  });

  test("marks an installed one-click provider that needs attention", () => {
    const visible = visibleIntegrationCatalog([
      {
        id: "slack-default",
        manifestId: "slack",
        providerName: "Slack",
        name: "Slack · Acme",
        description: "Messages",
        category: "connector",
        status: "not_connected",
        installed: true,
        featured: true,
        credentialKind: "oauth",
        oauthReady: true,
      },
    ]);

    const slack = oneClickIntegrations(visible)[0];
    expect(slack).toBeDefined();
    if (!slack) throw new Error("Expected Slack in the one-click row");
    expect(oneClickIntegrationState(slack)).toBe("needs_attention");
  });
});

describe("connection account display", () => {
  test("keeps the provider as the card title and the email as the account line", () => {
    const card = {
      name: "Gmail · work@example.com",
      providerName: "Gmail",
    };
    expect(connectionAccountLabel(card)).toBe("work@example.com");
    expect(connectionCardTitle(card, true)).toBe("Gmail");
    expect(connectionCardTitle(card, false)).toBe("Gmail");
  });

  test("keeps a renamed label as the title and still shows the stored account", () => {
    const card = {
      name: "Work inbox",
      providerName: "Gmail",
      accountLabel: "work@example.com",
    };
    expect(connectionAccountLabel(card)).toBe("work@example.com");
    expect(connectionCardTitle(card, true)).toBe("Work inbox");
  });

  test("does not invent an account line when only a custom name exists", () => {
    expect(
      connectionAccountLabel({
        name: "Acme workspace",
        providerName: "Notion",
      }),
    ).toBeUndefined();
    expect(
      connectionCardTitle(
        { name: "Acme workspace", providerName: "Notion" },
        true,
      ),
    ).toBe("Acme workspace");
  });
});
