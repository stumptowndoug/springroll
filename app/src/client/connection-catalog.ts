import type { ConnectionCardDto } from "../shared.ts";

export type ConnectionStatusFilter = "all" | "connected" | "disconnected";

export function visibleIntegrationCatalog(
  connections: readonly ConnectionCardDto[],
): readonly ConnectionCardDto[] {
  return connections.filter(
    (card) =>
      card.category === "connector" &&
      (card.status === "connected" ||
        card.installed === true ||
        card.featured === true),
  );
}

const standardConnectorOrder = [
  "gmail",
  "google-calendar",
  "google-drive",
  "outlook",
  "onedrive",
  "microsoft-teams",
  "sharepoint",
  "slack",
  "github",
  "jira",
  "linear",
  "notion",
  "salesforce",
  "stripe",
  "neon",
] as const;

const standardConnectorRank = new Map<string, number>(
  standardConnectorOrder.map((id, index) => [id, index]),
);

export function installedIntegrationAccounts(
  connections: readonly ConnectionCardDto[],
): readonly ConnectionCardDto[] {
  return connections
    .filter((card) => card.installed === true)
    .toSorted((left, right) => {
      if (left.status !== right.status) {
        return left.status === "connected" ? -1 : 1;
      }
      return (left.providerName ?? left.name).localeCompare(
        right.providerName ?? right.name,
      );
    });
}

export function standardIntegrationCatalog(
  connections: readonly ConnectionCardDto[],
): readonly ConnectionCardDto[] {
  const providers = new Map<string, ConnectionCardDto>();
  for (const card of connections) {
    if (card.featured !== true) continue;
    const providerId = card.manifestId ?? card.id;
    const existing = providers.get(providerId);
    if (!existing || card.status === "connected") {
      providers.set(providerId, card);
    }
  }
  return [...providers.values()].toSorted((left, right) => {
    const leftId = left.manifestId ?? left.id;
    const rightId = right.manifestId ?? right.id;
    const leftRank =
      standardConnectorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      standardConnectorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER;
    return (
      leftRank - rightRank ||
      (left.providerName ?? left.name).localeCompare(
        right.providerName ?? right.name,
      )
    );
  });
}

export function connectionCatalogTags(
  connections: readonly ConnectionCardDto[],
): readonly string[] {
  return [
    ...new Set(connections.flatMap((connection) => connection.tags ?? [])),
  ].sort();
}

export function oneClickIntegrations(
  connections: readonly ConnectionCardDto[],
): readonly ConnectionCardDto[] {
  const providers = new Map<string, ConnectionCardDto>();
  for (const card of connections) {
    if (card.installed === true) continue;
    if (
      card.featured !== true &&
      card.setupVariantId === undefined &&
      card.oauthReady !== true
    ) {
      continue;
    }
    const isOneClick =
      card.credentialKind === "oauth" ||
      card.setupVariantId !== undefined ||
      card.oauthReady === true;
    if (!isOneClick) continue;
    const providerId = card.manifestId ?? card.id;
    const existing = providers.get(providerId);
    if (!existing || (!card.installed && existing.installed)) {
      providers.set(providerId, card);
    }
  }
  return [...providers.values()].toSorted((left, right) => {
    const leftId = left.manifestId ?? left.id;
    const rightId = right.manifestId ?? right.id;
    const leftRank =
      standardConnectorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      standardConnectorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER;
    return (
      leftRank - rightRank ||
      (left.providerName ?? left.name).localeCompare(
        right.providerName ?? right.name,
      )
    );
  });
}

export function filterIntegrationCatalog(
  connections: readonly ConnectionCardDto[],
  filter: {
    readonly query: string;
    readonly status: ConnectionStatusFilter;
    readonly tag?: string | undefined;
    readonly oneClickOnly?: boolean | undefined;
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
    if (filter.oneClickOnly) {
      const isOneClick =
        card.credentialKind === "oauth" ||
        card.setupVariantId !== undefined ||
        card.oauthReady === true;
      if (!isOneClick) return false;
    }
    if (filter.tag && !card.tags?.includes(filter.tag)) return false;
    return (
      search === "" ||
      [
        card.name,
        card.providerName,
        card.description,
        card.operator,
        ...(card.tags ?? []),
      ]
        .filter((value): value is string => value !== undefined)
        .some((value) => value.toLowerCase().includes(search))
    );
  });
}
