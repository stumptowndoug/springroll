export interface ChatToolPresentation {
  readonly label: string;
  readonly detail?: string;
}

export function describeChatToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): ChatToolPresentation {
  const input = asRecord(part.input);
  if (part.type === "tool-springroll_list_connections") {
    return { label: "Inspect connections" };
  }
  if (part.type === "tool-springroll_research_connection") {
    return withDetail("Research connection", detailFromInput(input));
  }
  if (part.type === "tool-springroll_describe_connection_tools") {
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · Inspect tools`,
      detailFromInput(input),
    );
  }
  if (part.type === "tool-springroll_call_read_connection_tool") {
    const toolInput = asRecord(input?.input);
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · ${humanize(input?.toolName) || "Read tool"}`,
      detailFromInput(toolInput),
    );
  }
  return withDetail(
    humanize(part.type.replace(/^tool-/, "")) || "Tool",
    detailFromInput(input),
  );
}

function withDetail(
  label: string,
  detail: string | undefined,
): ChatToolPresentation {
  return detail ? { label, detail } : { label };
}

function detailFromInput(input: Record<string, unknown> | undefined) {
  if (!input) return undefined;
  for (const key of ["intent", "query", "url", "taskId", "runId"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().replace(/\s+/g, " ");
      return normalized.length <= 180
        ? normalized
        : `${normalized.slice(0, 177).trimEnd()}…`;
    }
  }
  return undefined;
}

function humanize(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/^springroll_/, "")
    .replaceAll(/[-_]+/g, " ")
    .trim();
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word.toLocaleLowerCase(),
    )
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
