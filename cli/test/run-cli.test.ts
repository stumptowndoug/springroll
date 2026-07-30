import { describe, expect, test } from "bun:test";
import type { RunTaskResult } from "@shrimp-roll/kernel";
import { type CliActions, runCli } from "../src/run-cli.ts";

function createHarness(overrides: Partial<CliActions> = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  const actions: CliActions = {
    async connectOpenAi() {
      return { provider: "openai", modelId: "test-model" };
    },
    async runHackerNewsDigest(): Promise<RunTaskResult> {
      return {
        transcript: {
          summary: "HN digest",
          body: "A readable Hacker News digest.",
        },
        toolCalls: [],
        usage: {
          totalTokens: 42,
          costUsdMicros: 123,
        },
        startedAt: new Date("2026-07-31T15:00:00.000Z"),
        finishedAt: new Date("2026-07-31T15:00:01.000Z"),
      };
    },
    ...overrides,
  };

  return {
    actions,
    output,
    errors,
    cliOutput: {
      write: (message: string) => output.push(message),
      writeError: (message: string) => errors.push(message),
    },
  };
}

describe("development CLI", () => {
  test("shows the API-key setup link without exposing a secret", async () => {
    const harness = createHarness();

    const exitCode = await runCli(["openai:connect"], {
      actions: harness.actions,
      environment: {},
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(1);
    expect(harness.errors.join("\n")).toContain(
      "https://platform.openai.com/api-keys",
    );
  });

  test("passes the environment key to the secure connection action", async () => {
    const receivedKeys: string[] = [];
    const harness = createHarness({
      async connectOpenAi(apiKey) {
        receivedKeys.push(apiKey);
        return { provider: "openai", modelId: "test-model" };
      },
    });

    const exitCode = await runCli(["openai:connect"], {
      actions: harness.actions,
      environment: { OPENAI_API_KEY: "sk-test-secret" },
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(0);
    expect(receivedKeys).toEqual(["sk-test-secret"]);
    expect([...harness.output, ...harness.errors].join("\n")).not.toContain(
      "sk-test-secret",
    );
  });

  test("prints the live digest and quiet run metadata", async () => {
    const harness = createHarness();

    const exitCode = await runCli(["hn:once"], {
      actions: harness.actions,
      environment: {},
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(0);
    expect(harness.output).toEqual([
      "A readable Hacker News digest.",
      "\nRun metadata: 42 tokens · $0.000123 estimated · 1000 ms",
    ]);
  });
});
