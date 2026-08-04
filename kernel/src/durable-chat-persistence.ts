import type { JsonObject, JsonValue } from "./tools.ts";

const durablePartsBudget = 240_000;
const transientProviderKeys = new Set([
  "providerMetadata",
  "callProviderMetadata",
  "resultProviderMetadata",
  "providerOptions",
  "callProviderOptions",
  "resultProviderOptions",
]);

export function toDurableChatParts(
  parts: readonly { readonly type: string; readonly [key: string]: unknown }[],
): JsonObject[] {
  const safeParts = parts
    .filter(
      (part) => part.type !== "reasoning" && part.type !== "reasoning-file",
    )
    .map((part) => stripTransientProviderData(part) as JsonObject);
  const durable: JsonObject[] = [];
  let size = 2;
  for (const part of safeParts) {
    const partSize = JSON.stringify(part).length + 1;
    if (size + partSize <= durablePartsBudget) {
      durable.push(part);
      size += partSize;
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      const remaining = Math.max(0, durablePartsBudget - size - 200);
      if (remaining > 0) {
        durable.push({
          type: "text",
          text: `${part.text.slice(0, remaining)}\n\n[Response truncated in durable history]`,
          state: "done",
        });
      }
    } else {
      durable.push({
        type: "data-springroll-truncated",
        data: {
          originalType: typeof part.type === "string" ? part.type : "unknown",
          reason: "durable_size_limit",
        },
      });
    }
    break;
  }
  return durable;
}

export function toDurableChatMetadata(
  metadata: JsonObject | undefined,
  fallback: JsonObject,
): JsonObject {
  return stripTransientProviderData({ ...fallback, ...metadata }) as JsonObject;
}

function stripTransientProviderData(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(stripTransientProviderData);
  }
  if (typeof value !== "object") return null;
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (transientProviderKeys.has(key) || item === undefined) continue;
    result[key] = stripTransientProviderData(item);
  }
  return result;
}
