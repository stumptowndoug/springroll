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
