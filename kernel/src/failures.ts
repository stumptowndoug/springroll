import { ToolPolicyError } from "./tools.ts";

export type RunFailureCategory =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "policy"
  | "invalid_response"
  | "unknown";

export interface FailureClassification {
  readonly category: RunFailureCategory;
  readonly retryable: boolean;
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

export class HttpStatusError extends Error {
  override readonly name = "HttpStatusError";

  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class InvalidResponseError extends Error {
  override readonly name = "InvalidResponseError";
}

const publicFailureMessageLimit = 500;

const categoryFallback: Record<RunFailureCategory, string> = {
  authentication: "The model provider rejected the credentials.",
  rate_limit: "The model provider rate-limited the request.",
  timeout: "The model request timed out.",
  network: "The model provider could not be reached.",
  policy: "The request was blocked by a tool policy.",
  invalid_response: "The model provider returned an invalid response.",
  unknown: "Assistant response failed",
};

/** User-visible failure text. Strips URLs and secrets; never dumps request bodies. */
export function publicFailureMessage(error: unknown): string {
  const cause = unwrapRetryError(error);
  if (cause instanceof TypeError || cause instanceof RangeError) {
    return sanitizePublicErrorText(cause.message) ?? categoryFallback.unknown;
  }
  if (cause instanceof ToolPolicyError) {
    return sanitizePublicErrorText(cause.message) ?? categoryFallback.policy;
  }

  const classification = classifyFailure(error);
  const statusCode = readStatusCode(cause);
  const text =
    sanitizePublicErrorText(readProviderErrorText(cause)) ??
    categoryFallback[classification.category];
  if (statusCode !== undefined && !text.includes(`HTTP ${statusCode}`)) {
    return `${text} (HTTP ${statusCode})`;
  }
  return text;
}

export function classifyFailure(error: unknown): FailureClassification {
  const cause = unwrapRetryError(error);

  if (cause instanceof ToolPolicyError) {
    return { category: "policy", retryable: false };
  }

  const statusCode = readStatusCode(cause);
  if (statusCode === 401 || statusCode === 403) {
    return { category: "authentication", retryable: false };
  }
  if (statusCode === 429) {
    return { category: "rate_limit", retryable: true };
  }
  if (statusCode === 408 || statusCode === 504) {
    return { category: "timeout", retryable: true };
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return { category: "network", retryable: true };
  }
  if (statusCode !== undefined && statusCode >= 400) {
    return { category: "invalid_response", retryable: false };
  }

  const name = readName(cause);
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    name === "DeadlineExceededError"
  ) {
    return { category: "timeout", retryable: true };
  }
  if (name === "LoadAPIKeyError" || name === "MissingCredentialError") {
    return { category: "authentication", retryable: false };
  }
  if (
    name === "JSONParseError" ||
    name === "SyntaxError" ||
    name === "TypeValidationError" ||
    name === "InvalidResponseDataError" ||
    name === "InvalidResponseError"
  ) {
    return { category: "invalid_response", retryable: false };
  }
  if (
    cause instanceof TypeError ||
    hasNetworkErrorCode(cause) ||
    name === "NetworkError"
  ) {
    return { category: "network", retryable: true };
  }

  return { category: "unknown", retryable: false };
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("maxRetries must be a non-negative integer");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError("baseDelayMs must be a non-negative number");
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const classification = classifyFailure(error);
      if (!classification.retryable || attempt >= maxRetries) {
        throw error;
      }

      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

function readProviderErrorText(error: unknown): string | undefined {
  const nested = readNestedProviderMessage(error);
  if (nested) return nested;
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const name = readName(error);
    const providerShaped =
      readStatusCode(error) !== undefined ||
      (typeof name === "string" &&
        (name.startsWith("AI_") ||
          name === "APICallError" ||
          name === "RetryError" ||
          name === "TimeoutError" ||
          name === "AbortError" ||
          name === "DeadlineExceededError" ||
          name === "NetworkError"));
    if (providerShaped) return error.message;
  }
  return undefined;
}

function readNestedProviderMessage(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const fromData = readErrorMessageField(error.data);
  if (fromData) return fromData;
  if (
    typeof error.responseBody === "string" &&
    error.responseBody.length > 0 &&
    error.responseBody.length <= 4_000
  ) {
    try {
      return readErrorMessageField(JSON.parse(error.responseBody));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readErrorMessageField(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.message === "string" && value.message.trim()) {
    return value.message;
  }
  if (typeof value.error === "string" && value.error.trim()) {
    return value.error;
  }
  if (isRecord(value.error)) {
    if (typeof value.error.message === "string" && value.error.message.trim()) {
      return value.error.message;
    }
    if (typeof value.error.code === "string" && value.error.code.trim()) {
      return value.error.code;
    }
  }
  return undefined;
}

function sanitizePublicErrorText(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > publicFailureMessageLimit
    ? `${text.slice(0, publicFailureMessageLimit)}…`
    : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unwrapRetryError(error: unknown): unknown {
  if (
    error !== null &&
    typeof error === "object" &&
    "lastError" in error &&
    error.lastError !== undefined
  ) {
    return error.lastError;
  }

  return error;
}

function readStatusCode(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return undefined;
}

function readName(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
  ) {
    return error.name;
  }

  return undefined;
}

function hasNetworkErrorCode(error: unknown): boolean {
  if (
    error === null ||
    typeof error !== "object" ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return false;
  }

  return [
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "ENETUNREACH",
    "ENOTFOUND",
    "EPIPE",
  ].includes(error.code);
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
