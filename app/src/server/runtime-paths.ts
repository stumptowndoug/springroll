import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimePathEnvironment {
  readonly [key: string]: string | undefined;
  readonly SPRINGROLL_DATA_DIR?: string;
  readonly SPRINGROLL_RESOURCES_DIR?: string;
  readonly SPRINGROLL_DB_PATH?: string;
  readonly SPRINGROLL_MODEL_CATALOG_PATH?: string;
}

/** Explicit package locations, with source-run defaults kept for development. */
export function resolveRuntimePaths(environment: RuntimePathEnvironment) {
  const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const dataDirectory =
    absoluteDirectory(environment.SPRINGROLL_DATA_DIR, "SPRINGROLL_DATA_DIR") ??
    join(sourceRoot, ".local");
  const resourcesDirectory =
    absoluteDirectory(
      environment.SPRINGROLL_RESOURCES_DIR,
      "SPRINGROLL_RESOURCES_DIR",
    ) ?? sourceRoot;
  const databasePath =
    environment.SPRINGROLL_DB_PATH ?? join(dataDirectory, "springroll.sqlite");

  return {
    databasePath,
    modelCatalogPath:
      environment.SPRINGROLL_MODEL_CATALOG_PATH ??
      join(dirname(databasePath), "model-catalog.sqlite"),
    migrationsFolder: join(resourcesDirectory, "drizzle"),
    indexPath: join(resourcesDirectory, "app", "src", "client", "index.html"),
    assetsDirectory: join(resourcesDirectory, "app", "dist"),
  };
}

function absoluteDirectory(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!isAbsolute(value))
    throw new TypeError(`${name} must be an absolute path`);
  return value;
}
