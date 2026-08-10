import type { JsonObject } from "./tools.ts";

export type ConnectionToolPolicyMode = "allow" | "check_first" | "off";

export function defaultConnectionToolPolicyMode(
  _effect: "read" | "write" | "destructive",
): ConnectionToolPolicyMode {
  return "allow";
}

export function connectionToolPolicyMode(
  config: JsonObject,
  toolName: string,
  effect: "read" | "write" | "destructive",
): ConnectionToolPolicyMode {
  const policies = connectionToolPolicies(config);
  return policies[toolName] ?? defaultConnectionToolPolicyMode(effect);
}

export function connectionToolPolicies(
  config: JsonObject,
): Readonly<Record<string, ConnectionToolPolicyMode>> {
  const value = config.toolPolicies;
  if (!isUnknownObject(value)) return {};

  const policies: Record<string, ConnectionToolPolicyMode> = {};
  for (const [name, mode] of Object.entries(value)) {
    if (
      name &&
      (mode === "allow" || mode === "check_first" || mode === "off")
    ) {
      policies[name] = mode;
    }
  }
  return policies;
}

export function withConnectionToolPolicy(
  config: JsonObject,
  toolName: string,
  mode: ConnectionToolPolicyMode,
): JsonObject {
  return {
    ...config,
    toolPolicies: {
      ...connectionToolPolicies(config),
      [toolName]: mode,
    },
  };
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
