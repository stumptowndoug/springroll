import type { ModelMessage } from "ai";

const webSearchToolNames = new Set([
  "search_web",
  "springroll_search_connector_sources",
]);
const webReadToolNames = new Set([
  "fetch_public_url",
  "springroll_inspect_connector_source",
]);
const compactSearchCharacters = 1_500;
const compactReadCharacters = 2_500;

/**
 * Once research has moved from ranked search leads into exact page reads, the
 * earlier search payload is superseded. Preserve a small evidence ledger and
 * the latest exact read instead of rebilling every discovery excerpt on every
 * later model step. After multiple reads, older reads are bounded as well.
 */
export function compactSupersededWebResearchMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] | undefined {
  const locations = toolResultLocations(messages);
  const readLocations = locations.filter(({ toolName }) =>
    webReadToolNames.has(toolName),
  );
  const latestRead = readLocations.at(-1);
  if (!latestRead) return undefined;

  const compacted: unknown = JSON.parse(JSON.stringify(messages));
  if (!Array.isArray(compacted)) return undefined;
  let changed = false;
  for (const location of locations) {
    const isSupersededSearch =
      webSearchToolNames.has(location.toolName) &&
      location.order < latestRead.order;
    const isOlderRead =
      webReadToolNames.has(location.toolName) &&
      location.order < latestRead.order;
    if (!isSupersededSearch && !isOlderRead) continue;

    const message = compacted[location.messageIndex];
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    const part = message.content[location.partIndex];
    if (!isRecord(part) || part.type !== "tool-result") continue;
    const output = encodedToolOutput(part.output);
    const limit = isSupersededSearch
      ? compactSearchCharacters
      : compactReadCharacters;
    if (output.length <= limit) continue;
    const urls = [...new Set(output.match(/https?:\/\/[^\s"'<>\\)]+/g) ?? [])]
      .slice(0, 8)
      .join("\n");
    const excerptLimit = Math.max(200, limit - urls.length - 180);
    part.output = {
      type: "text",
      value: [
        `[Web evidence ledger: superseded ${location.toolName} result compacted from ${output.length.toLocaleString()} characters]`,
        output.slice(0, excerptLimit),
        urls ? `Sources retained:\n${urls}` : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n\n"),
    };
    changed = true;
  }
  return changed ? (compacted as ModelMessage[]) : undefined;
}

function toolResultLocations(messages: readonly ModelMessage[]): Array<{
  readonly messageIndex: number;
  readonly partIndex: number;
  readonly order: number;
  readonly toolName: string;
}> {
  const locations: Array<{
    readonly messageIndex: number;
    readonly partIndex: number;
    readonly order: number;
    readonly toolName: string;
  }> = [];
  let order = 0;
  for (const [messageIndex, message] of (
    messages as readonly unknown[]
  ).entries()) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const [partIndex, part] of message.content.entries()) {
      if (
        isRecord(part) &&
        part.type === "tool-result" &&
        typeof part.toolName === "string"
      ) {
        locations.push({
          messageIndex,
          partIndex,
          order,
          toolName: part.toolName,
        });
        order += 1;
      }
    }
  }
  return locations;
}

function encodedToolOutput(output: unknown): string {
  if (
    isRecord(output) &&
    (output.type === "text" || output.type === "error-text") &&
    typeof output.value === "string"
  ) {
    return output.value;
  }
  if (
    isRecord(output) &&
    (output.type === "json" || output.type === "error-json")
  ) {
    return JSON.stringify(output.value);
  }
  return JSON.stringify(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
