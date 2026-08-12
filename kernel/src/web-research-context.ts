import type { ModelMessage } from "ai";

const connectorProposalToolNames = new Set([
  "propose_connection",
  "propose_local_mcp",
  "propose_openapi_connection",
]);
/**
 * Connector research can legitimately revise a proposal, but the full inputs
 * and validation output from every abandoned draft should not be sent back to
 * the model forever. Keep the newest proposal intact and reduce older drafts
 * to a small ledger entry. The durable chat history remains unchanged.
 */
export function compactSupersededConnectorProposalMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] | undefined {
  const calls = toolCallLocations(messages).filter(({ toolName }) =>
    connectorProposalToolNames.has(toolName),
  );
  const latestCall = calls.at(-1);
  if (!latestCall || calls.length < 2) return undefined;

  const compacted: unknown = JSON.parse(JSON.stringify(messages));
  if (!Array.isArray(compacted)) return undefined;
  const supersededCallIds = new Set(
    calls
      .filter(({ order }) => order < latestCall.order)
      .map(({ toolCallId }) => toolCallId),
  );
  let changed = false;
  for (const location of calls) {
    if (!supersededCallIds.has(location.toolCallId)) continue;
    const message = compacted[location.messageIndex];
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    const part = message.content[location.partIndex];
    if (!isRecord(part) || part.type !== "tool-call") continue;
    part.input = connectorProposalLedger(part.input);
    changed = true;
  }
  for (const [messageIndex, message] of compacted.entries()) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const [partIndex, part] of message.content.entries()) {
      if (
        !isRecord(part) ||
        part.type !== "tool-result" ||
        typeof part.toolCallId !== "string" ||
        !supersededCallIds.has(part.toolCallId)
      ) {
        continue;
      }
      const current = compacted[messageIndex];
      if (!isRecord(current) || !Array.isArray(current.content)) continue;
      const currentPart = current.content[partIndex];
      if (!isRecord(currentPart)) continue;
      currentPart.output = {
        type: "json",
        value: {
          status: "superseded",
          note: "An earlier connector proposal was replaced by a newer draft.",
        },
      };
      changed = true;
    }
  }
  return changed ? (compacted as ModelMessage[]) : undefined;
}

function connectorProposalLedger(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return { superseded: true };
  const transport = isRecord(input.transport) ? input.transport : undefined;
  return {
    superseded: true,
    ...(typeof input.name === "string"
      ? { name: input.name.slice(0, 100) }
      : {}),
    ...(transport && typeof transport.kind === "string"
      ? { transport: { kind: transport.kind } }
      : {}),
  };
}

function toolCallLocations(messages: readonly ModelMessage[]): Array<{
  readonly messageIndex: number;
  readonly partIndex: number;
  readonly order: number;
  readonly toolCallId: string;
  readonly toolName: string;
}> {
  const locations: Array<{
    readonly messageIndex: number;
    readonly partIndex: number;
    readonly order: number;
    readonly toolCallId: string;
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
        part.type === "tool-call" &&
        typeof part.toolCallId === "string" &&
        typeof part.toolName === "string"
      ) {
        locations.push({
          messageIndex,
          partIndex,
          order,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
        });
        order += 1;
      }
    }
  }
  return locations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
