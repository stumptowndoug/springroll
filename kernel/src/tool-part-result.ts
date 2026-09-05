/** Normalize SDK tool parts without changing their stored trace or call identity. */
export function toolPartName(part: {
  readonly type: string;
  readonly toolName?: unknown;
}): string | undefined {
  if (part.type === "dynamic-tool")
    return typeof part.toolName === "string" ? part.toolName : undefined;
  return part.type.startsWith("tool-") ? part.type.slice(5) : undefined;
}

export function toolPartOutput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const output = value as Record<string, unknown>;
  if (output.isError === true) return undefined;
  if (output.structuredContent && typeof output.structuredContent === "object")
    return output.structuredContent;
  if (typeof output.status === "string") return output;
  if (Array.isArray(output.content) && output.content.length === 1) {
    const content = output.content[0];
    if (content && typeof content === "object") {
      if (typeof content.status === "string") return content;
      if (content.type === "text" && typeof content.text === "string") {
        try {
          return JSON.parse(content.text);
        } catch {
          return undefined;
        }
      }
    }
  }
  return value;
}
