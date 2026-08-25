import { describe, expect, test } from "bun:test";
import {
  connectionCatalogTags,
  filterIntegrationCatalog,
  installedIntegrationAccounts,
  oneClickIntegrations,
  standardIntegrationCatalog,
  visibleIntegrationCatalog,
} from "../src/client/connection-catalog.ts";
import type { ConnectionCardDto } from "../src/shared.ts";

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

  test("extracts one-click ready connectors", () => {
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
    ]);
    const oneClick = oneClickIntegrations(visible);
    expect(oneClick.map((card) => card.id)).toEqual(["github"]);
  });
});
