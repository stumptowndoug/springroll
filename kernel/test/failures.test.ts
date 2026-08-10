import { describe, expect, test } from "bun:test";
import { MissingCredentialError } from "../src/credentials.ts";
import {
  classifyFailure,
  HttpStatusError,
  withRetry,
} from "../src/failures.ts";
import { ToolPolicyError } from "../src/tools.ts";

describe("failure policy", () => {
  test("classifies actionable failure categories", () => {
    expect(classifyFailure(new HttpStatusError(401, "unauthorized"))).toEqual({
      category: "authentication",
      retryable: false,
    });
    expect(classifyFailure(new HttpStatusError(429, "slow down"))).toEqual({
      category: "rate_limit",
      retryable: true,
    });
    expect(
      classifyFailure(new DOMException("timed out", "TimeoutError")),
    ).toEqual({
      category: "timeout",
      retryable: true,
    });
    expect(classifyFailure(new ToolPolicyError("not approved"))).toEqual({
      category: "policy",
      retryable: false,
    });
    expect(
      classifyFailure(
        new MissingCredentialError("connector needs reconnecting"),
      ),
    ).toEqual({
      category: "authentication",
      retryable: false,
    });
  });

  test("retries only transient failures and stops at the configured bound", async () => {
    const attempts: number[] = [];
    const delays: number[] = [];

    await expect(
      withRetry(
        async (attempt) => {
          attempts.push(attempt);
          throw new HttpStatusError(503, "temporarily unavailable");
        },
        {
          maxRetries: 2,
          baseDelayMs: 10,
          sleep: async (delayMs) => {
            delays.push(delayMs);
          },
        },
      ),
    ).rejects.toThrow("temporarily unavailable");
    expect(attempts).toEqual([0, 1, 2]);
    expect(delays).toEqual([10, 20]);
  });

  test("does not retry permanent failures", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new HttpStatusError(403, "forbidden");
        },
        {
          maxRetries: 3,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow("forbidden");
    expect(attempts).toBe(1);
  });
});
