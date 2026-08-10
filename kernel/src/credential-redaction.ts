import type { JsonValue } from "./tools.ts";

const redactedCredential = "[REDACTED]";

export function redactCredentialText(
  value: string,
  credentials: readonly (string | undefined)[],
): string {
  return normalizedCredentials(credentials).reduce(
    (safe, credential) => safe.split(credential).join(redactedCredential),
    value,
  );
}

export function redactCredentialJson(
  value: JsonValue,
  credentials: readonly (string | undefined)[],
): JsonValue {
  const normalized = normalizedCredentials(credentials);
  if (normalized.length === 0) return value;
  if (typeof value === "string") {
    return redactCredentialText(value, normalized);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactCredentialJson(entry, normalized));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactCredentialText(key, normalized),
        redactCredentialJson(entry, normalized),
      ]),
    );
  }
  return value;
}

function normalizedCredentials(
  values: readonly (string | undefined)[],
): readonly string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((left, right) => right.length - left.length);
}
