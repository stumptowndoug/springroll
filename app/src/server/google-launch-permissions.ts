import type { ConnectorManifest } from "@springroll/kernel";

const googleIds = new Set(["gmail", "google-calendar", "google-drive"]);

/** Pending Google write scopes are available only in explicit local staging. */
export function googleLaunchManifest(
  manifest: ConnectorManifest,
  writeStaging = false,
): ConnectorManifest {
  if (!googleIds.has(manifest.id) || writeStaging) return manifest;
  if (
    manifest.credential.kind !== "oauth" ||
    manifest.transport.kind !== "http-api"
  )
    return manifest;
  const operations = manifest.transport.operations.filter(
    (operation) => operation.effect === "read",
  );
  const names = new Set(operations.map((operation) => operation.name));
  return {
    ...manifest,
    credential: {
      ...manifest.credential,
      permissionSets: manifest.credential.permissionSets?.filter(
        (set) => set.required,
      ),
    },
    transport: { ...manifest.transport, operations },
    tools: {
      ...manifest.tools,
      allow: manifest.tools?.allow?.filter((name) => names.has(name)),
      risk: Object.fromEntries(
        Object.entries(manifest.tools?.risk ?? {}).filter(([name]) =>
          names.has(name),
        ),
      ),
    },
  };
}
