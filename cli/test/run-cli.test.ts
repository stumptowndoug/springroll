import { describe, expect, test } from "bun:test";
import {
  createMarkdownRunResult,
  type RunTaskResult,
} from "@springroll/kernel";
import { type CliActions, runCli } from "../src/run-cli.ts";

function createHarness(overrides: Partial<CliActions> = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  const actions: CliActions = {
    async connectOpenAi() {
      return { provider: "openai", modelId: "test-model" };
    },
    async connectOpenRouter() {
      return { provider: "openrouter", modelId: "test-model" };
    },
    async connectXai() {
      return { provider: "xai", modelId: "test-model" };
    },
    async runHackerNewsDigest(): Promise<RunTaskResult> {
      return {
        result: createMarkdownRunResult({
          body: "A readable Hacker News digest.",
          fallbackSummary: "HN digest",
          summary: "HN digest",
        }),
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

  test("passes an OpenRouter key to the secure connection action", async () => {
    const receivedKeys: string[] = [];
    const harness = createHarness({
      async connectOpenRouter(apiKey) {
        receivedKeys.push(apiKey);
        return { provider: "openrouter", modelId: "test-model" };
      },
    });

    const exitCode = await runCli(["openrouter:connect"], {
      actions: harness.actions,
      environment: { OPENROUTER_API_KEY: "sk-or-v1-test-secret" },
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(0);
    expect(receivedKeys).toEqual(["sk-or-v1-test-secret"]);
    expect([...harness.output, ...harness.errors].join("\n")).not.toContain(
      "sk-or-v1-test-secret",
    );
  });

  test("passes an xAI key to the secure connection action", async () => {
    const receivedKeys: string[] = [];
    const harness = createHarness({
      async connectXai(apiKey) {
        receivedKeys.push(apiKey);
        return { provider: "xai", modelId: "grok-test" };
      },
    });

    const exitCode = await runCli(["xai:connect"], {
      actions: harness.actions,
      environment: { XAI_API_KEY: "xai-test-secret" },
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(0);
    expect(receivedKeys).toEqual(["xai-test-secret"]);
    expect([...harness.output, ...harness.errors].join("\n")).not.toContain(
      "xai-test-secret",
    );
  });

  test("selects xAI for a live digest", async () => {
    const receivedProviders: Array<string | undefined> = [];
    const harness = createHarness({
      async runHackerNewsDigest(provider) {
        receivedProviders.push(provider);
        return {
          result: createMarkdownRunResult({
            body: "An xAI Hacker News digest.",
            fallbackSummary: "HN digest",
            summary: "HN digest",
          }),
          toolCalls: [],
          usage: {},
          startedAt: new Date("2026-07-31T15:00:00.000Z"),
          finishedAt: new Date("2026-07-31T15:00:01.000Z"),
        };
      },
    });

    const exitCode = await runCli(["hn:once", "xai"], {
      actions: harness.actions,
      environment: {},
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(0);
    expect(receivedProviders).toEqual(["xai"]);
    expect(harness.output[0]).toBe("An xAI Hacker News digest.");
  });

  test("selects OpenRouter for a live digest", async () => {
    const receivedProviders: Array<string | undefined> = [];
    const harness = createHarness({
      async runHackerNewsDigest(provider) {
        receivedProviders.push(provider);
        return {
          result: createMarkdownRunResult({
            body: "An OpenRouter Hacker News digest.",
            fallbackSummary: "HN digest",
            summary: "HN digest",
          }),
          toolCalls: [],
          usage: {},
          startedAt: new Date("2026-07-31T15:00:00.000Z"),
          finishedAt: new Date("2026-07-31T15:00:01.000Z"),
        };
      },
    });

    const exitCode = await runCli(["hn:once", "openrouter"], {
      actions: harness.actions,
      environment: {},
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(0);
    expect(receivedProviders).toEqual(["openrouter"]);
    expect(harness.output[0]).toBe("An OpenRouter Hacker News digest.");
  });

  test("rejects an unknown live-digest provider", async () => {
    const harness = createHarness();

    const exitCode = await runCli(["hn:once", "unknown"], {
      actions: harness.actions,
      environment: {},
      output: harness.cliOutput,
    });

    expect(exitCode).toBe(1);
    expect(harness.errors).toEqual([
      'Unknown model provider "unknown"; expected openai, xai, or openrouter',
    ]);
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
