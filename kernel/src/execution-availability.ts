import type { ExecutionLocation } from "./contracts.ts";

const allLocations: readonly ExecutionLocation[] = ["local", "hosted"];

export interface HostingConnection {
  readonly id: string;
  readonly name: string;
  readonly availableIn: readonly ExecutionLocation[];
}

export interface RecipeHosting {
  readonly availableIn: readonly ExecutionLocation[];
  readonly hostedBlockedBy: readonly string[];
}

export function intersectAvailableIn(
  items: readonly (readonly ExecutionLocation[])[],
): readonly ExecutionLocation[] {
  if (items.length === 0) return allLocations;
  return allLocations.filter((location) =>
    items.every((availableIn) => availableIn.includes(location)),
  );
}

export function recipeHosting(
  connections: readonly HostingConnection[],
): RecipeHosting {
  const unique = new Map<string, HostingConnection>();
  for (const connection of connections) {
    unique.set(connection.id, connection);
  }
  const items = [...unique.values()];
  return {
    availableIn: intersectAvailableIn(
      items.map((connection) => connection.availableIn),
    ),
    hostedBlockedBy: [
      ...new Set(
        items
          .filter((connection) => !connection.availableIn.includes("hosted"))
          .map((connection) => connection.name),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  };
}
