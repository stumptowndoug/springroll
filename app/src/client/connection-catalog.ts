import type { ConnectionCardDto } from "../shared.ts";

export type ConnectionStatusFilter = "all" | "connected" | "disconnected";

export function visibleIntegrationCatalog(
  connections: readonly ConnectionCardDto[],
): readonly ConnectionCardDto[] {
  return connections.filter(
    (card) =>
      (card.category === "web-search" && card.id === "web-search") ||
      (card.category === "connector" &&
        (card.status === "connected" ||
          card.installed === true ||
          (card.featured === true && card.actionable === true))),
  );
}

export function connectionCatalogTags(
  connections: readonly ConnectionCardDto[],
): readonly string[] {
  return [
    ...new Set(connections.flatMap((connection) => connection.tags ?? [])),
  ].sort();
}

export function filterIntegrationCatalog(
  connections: readonly ConnectionCardDto[],
  filter: {
    readonly query: string;
    readonly status: ConnectionStatusFilter;
    readonly tag?: string;
  },
): readonly ConnectionCardDto[] {
  const search = filter.query.trim().toLowerCase();
  return connections.filter((card) => {
    if (filter.status === "connected" && card.status !== "connected") {
      return false;
    }
    if (filter.status === "disconnected" && card.status === "connected") {
      return false;
    }
    if (filter.tag && !card.tags?.includes(filter.tag)) return false;
    return (
      search === "" ||
      [card.name, card.description, card.operator, ...(card.tags ?? [])]
        .filter((value): value is string => value !== undefined)
        .some((value) => value.toLowerCase().includes(search))
    );
  });
}
