import type { ConnectorManifest } from "./connector-manifest.ts";
import type { JsonObject } from "./tools.ts";

export interface OAuthPermissionSet {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly scopes: readonly string[];
  readonly required: boolean;
  readonly supersedes: readonly string[];
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function oauthPermissionSets(
  manifest: ConnectorManifest,
): readonly OAuthPermissionSet[] {
  if (manifest.credential.kind !== "oauth") return [];
  return (manifest.credential.permissionSets ?? []).map((set) => ({
    id: set.id,
    label: set.label,
    summary: set.summary,
    scopes: set.scopes,
    required: set.required === true,
    supersedes: set.supersedes ?? [],
  }));
}

export function requiredOAuthPermissionSetIds(
  manifest: ConnectorManifest,
): readonly string[] {
  return oauthPermissionSets(manifest)
    .filter((set) => set.required)
    .map((set) => set.id);
}

export function grantedOAuthPermissionSetIds(
  config: JsonObject | undefined,
  manifest: ConnectorManifest,
): readonly string[] {
  const required = requiredOAuthPermissionSetIds(manifest);
  const stored = config?.grantedPermissionSets;
  if (!Array.isArray(stored)) return required;
  const known = new Set(oauthPermissionSets(manifest).map((set) => set.id));
  const granted = stored.filter(
    (value): value is string => typeof value === "string" && known.has(value),
  );
  return uniqueIds([...required, ...granted]);
}

export function nextOAuthPermissionSetIds(
  manifest: ConnectorManifest,
  config: JsonObject | undefined,
  extraSetId?: string,
): readonly string[] {
  const granted = grantedOAuthPermissionSetIds(config, manifest);
  if (!extraSetId) return granted;
  const match = oauthPermissionSets(manifest).find(
    (set) => set.id === extraSetId,
  );
  if (!match) {
    throw new TypeError(
      `${manifest.name} does not offer a ${extraSetId} permission`,
    );
  }
  return uniqueIds([...granted, extraSetId]);
}

export function oauthScopeForPermissionSets(
  manifest: ConnectorManifest,
  setIds: readonly string[],
): string | undefined {
  const sets = oauthPermissionSets(manifest);
  if (sets.length === 0) {
    return manifest.credential.kind === "oauth" &&
      manifest.credential.scopes?.length
      ? manifest.credential.scopes.join(" ")
      : undefined;
  }
  const selected = new Set(setIds);
  const superseded = new Set(
    sets.filter((set) => selected.has(set.id)).flatMap((set) => set.supersedes),
  );
  const scopes = uniqueIds(
    sets
      .filter((set) => selected.has(set.id) && !superseded.has(set.id))
      .flatMap((set) => set.scopes),
  );
  return scopes.length ? scopes.join(" ") : undefined;
}

export function permissionGatedToolNames(
  manifest: ConnectorManifest,
): ReadonlySet<string> {
  if (manifest.transport.kind !== "http-api") return new Set();
  return new Set(
    manifest.transport.operations
      .filter((operation) => operation.permissionSet)
      .map((operation) => operation.name),
  );
}

export function operationAllowedForGrantedPermissions(
  operation: {
    readonly name: string;
    readonly permissionSet?: string | undefined;
  },
  grantedSetIds: readonly string[],
): boolean {
  return (
    operation.permissionSet === undefined ||
    grantedSetIds.includes(operation.permissionSet)
  );
}

function uniqueIds(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export function withGrantedOAuthPermissionSets(
  config: JsonObject,
  setIds: readonly string[],
): JsonObject {
  return Object.fromEntries(
    Object.entries({
      ...config,
      grantedPermissionSets: [...setIds],
    }).filter(([key]) => key !== "oauthPendingPermissionSet"),
  );
}

export function pendingOAuthPermissionSet(
  config: JsonObject | undefined,
): string | undefined {
  if (!isObject(config)) return undefined;
  const value = config.oauthPendingPermissionSet;
  return typeof value === "string" && value.trim() ? value : undefined;
}
