function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function toolApprovalDetails(input: unknown): {
  readonly connectionId?: string;
  readonly toolName?: string;
  readonly input: string;
  readonly blockedReason?: string;
} {
  const wrapper = record(input);
  const args = record(wrapper?.input ?? input);
  const connectionId =
    typeof wrapper?.connectionId === "string"
      ? wrapper.connectionId
      : undefined;
  const toolName =
    typeof wrapper?.toolName === "string" ? wrapper.toolName : undefined;
  const email =
    connectionId?.startsWith("gmail-") &&
    (toolName === "create_draft" || toolName === "send_message");
  const missing = email
    ? ["to", "subject", "body"].filter((key) => typeof args?.[key] !== "string")
    : [];
  const encoded = email
    ? ["to", "cc", "bcc", "subject", "body", "threadId", "inReplyTo"]
        .filter(
          (key) =>
            args?.[key] !== undefined ||
            ["to", "subject", "body"].includes(key),
        )
        .map(
          (key) =>
            `${key === "to" ? "To" : key === "subject" ? "Subject" : key === "body" ? "Body" : key}: ${args?.[key] === undefined ? "[missing]" : String(args[key])}`,
        )
        .join("\n\n")
    : JSON.stringify(wrapper?.input ?? input ?? {}, null, 2);
  return {
    ...(connectionId ? { connectionId } : {}),
    ...(toolName ? { toolName } : {}),
    input: encoded === "{}" ? "No parameters supplied." : encoded,
    ...(missing.length
      ? {
          blockedReason: `This email action is incomplete: ${missing.join(", ")} missing. Deny this request and try again; there is no complete email to approve.`,
        }
      : {}),
  };
}
