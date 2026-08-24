import type { JsonObject, JsonValue } from "./tools.ts";

export type GmailRfc822Envelope = "message" | "raw";

function requiredString(input: JsonObject, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function optionalString(input: JsonObject, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function headerLine(
  name: string,
  value: string | undefined,
): string | undefined {
  return value ? `${name}: ${encodeHeaderValue(value)}` : undefined;
}

export function gmailRfc822Raw(input: JsonObject): string {
  const to = requiredString(input, "to");
  const subject = requiredString(input, "subject");
  const body = requiredString(input, "body");
  const headers = [
    headerLine("To", to),
    headerLine("Cc", optionalString(input, "cc")),
    headerLine("Bcc", optionalString(input, "bcc")),
    headerLine("Subject", subject),
    headerLine("In-Reply-To", optionalString(input, "inReplyTo")),
    headerLine("References", optionalString(input, "inReplyTo")),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ].filter((line): line is string => line !== undefined);
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString(
    "base64url",
  );
}

export function gmailRfc822RequestBody(
  input: JsonObject,
  envelope: GmailRfc822Envelope,
): JsonValue {
  const raw = gmailRfc822Raw(input);
  const threadId = optionalString(input, "threadId");
  const message = threadId ? { raw, threadId } : { raw };
  return envelope === "message" ? { message } : message;
}
