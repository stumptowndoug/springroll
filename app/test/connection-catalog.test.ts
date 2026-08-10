import { describe, expect, test } from "bun:test";
import {
  connectionCatalogTags,
  filterIntegrationCatalog,
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
];

describe("unified integration catalog", () => {
  test("includes built-in search beside usable and installed connectors", () => {
    const visible = visibleIntegrationCatalog(cards);
    expect(visible.map((card) => card.id)).toEqual([
      "web-search",
      "notion",
      "firebase",
    ]);
    expect(connectionCatalogTags(visible)).toEqual([
      "database",
      "search",
      "web",
      "workspace",
    ]);
  });

  test("filters by tag, status, and searchable metadata", () => {
    const visible = visibleIntegrationCatalog(cards);
    expect(
      filterIntegrationCatalog(visible, {
        query: "",
        status: "all",
        tag: "search",
      }).map((card) => card.id),
    ).toEqual(["web-search"]);
    expect(
      filterIntegrationCatalog(visible, {
        query: "backend",
        status: "disconnected",
      }).map((card) => card.id),
    ).toEqual(["firebase"]);
  });
});
