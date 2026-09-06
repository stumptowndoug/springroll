/**
 * Compact tool-result labels for both chat turns and scheduled runs.
 * "342 characters" / "2.6 kB" / "3 rows" — not a dumped excerpt.
 */

const COUNTABLE: readonly (readonly [string, string, string])[] = [
  ["results", "result", "results"],
  ["rows", "row", "rows"],
  ["connections", "connection", "connections"],
  ["tasks", "recipe", "recipes"],
  ["runs", "run", "runs"],
  ["tools", "tool", "tools"],
  ["operations", "operation", "operations"],
  ["sources", "source", "sources"],
  ["candidates", "candidate", "candidates"],
  ["approvals", "approval", "approvals"],
  ["notes", "note", "notes"],
  ["matches", "match", "matches"],
  ["items", "item", "items"],
  ["artifacts", "image", "images"],
];

export function summarizeToolOutput(output: unknown): string | undefined {
  if (Array.isArray(output)) return countLabel(output.length, "item", "items");
  const record = asRecord(output);
  if (!record) return undefined;
  const structured = asRecord(record.structuredContent);
  const distilled = structured?.distilled === true;
  const artifacts = record.artifacts ?? structured?.artifacts;
  if (Array.isArray(artifacts)) {
    return countLabel(artifacts.length, "image", "images");
  }
  // Text may contain only a provider/freshness preamble while the actual
  // results live in structured content. Prefer their meaningful count.
  for (const [key, singular, plural] of COUNTABLE) {
    const value = structured?.[key];
    if (Array.isArray(value)) return countLabel(value.length, singular, plural);
  }
  const size = mcpContentSize(record.content);
  if (size !== undefined) {
    const read = formatToolOutputSize(size);
    return distilled ? `distilled · ${read}` : read;
  }
  for (const key of [
    "deleted",
    "removed",
    "disconnected",
    "reconnected",
    "paused",
    "resumed",
    "created",
    "updated",
  ] as const) {
    if (record[key] === true) return key;
  }
  if (record.found === false) return "not found";
  if (typeof record.status === "string" && record.status.trim()) {
    return record.status.replaceAll("_", " ");
  }
  for (const [key, singular, plural] of COUNTABLE) {
    const value = record[key];
    if (Array.isArray(value)) return countLabel(value.length, singular, plural);
  }
  if (typeof record.matchCount === "number") {
    return countLabel(record.matchCount, "match", "matches");
  }
  const nested = asRecord(record.structuredContent);
  return nested ? summarizeToolOutput(nested) : undefined;
}

/**
 * Older run events stored a truncated prose excerpt instead of a compact
 * label. Keep short labels; size the rest so the step row still matches chat.
 */
export function compactToolResultLabel(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 60) return trimmed;
  return formatToolOutputSize(trimmed.length);
}

export function formatToolOutputSize(characters: number): string {
  return characters < 1_000
    ? `${characters.toLocaleString()} characters`
    : `${(Math.round(characters / 100) / 10).toLocaleString()} kB`;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function mcpContentSize(content: unknown): number | undefined {
  if (!Array.isArray(content)) return undefined;
  let size = 0;
  for (const entry of content) {
    if (typeof entry === "string") {
      size += entry.length;
      continue;
    }
    const text = asRecord(entry)?.text;
    if (typeof text === "string") size += text.length;
  }
  return size;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
