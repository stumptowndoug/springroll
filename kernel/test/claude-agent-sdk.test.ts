import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  createSdkMcpServer,
  query,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentRunner } from "../src/claude-agent-runner.ts";
import {
  bundledClaudePath,
  ClaudeSubscriptionConnection,
  type RunClaudeCommand,
} from "../src/claude-agent-sdk.ts";
import type { AgentRunRequest } from "../src/run-task.ts";

describe("Claude Agent SDK integration", () => {
  test("uses the SDK-bundled platform executable", () => {
    expect(bundledClaudePath()).toEndWith("/claude");
  });

  test("reads and manages an isolated Claude subscription account", async () => {
    const claudeHome = mkdtempSync(join(tmpdir(), "springroll-claude-auth-"));
    const calls: Array<{
      args: readonly string[];
      executable: string;
      configDir: string | undefined;
    }> = [];
    let connected = false;
    const run: RunClaudeCommand = async (args, options) => {
      calls.push({
        args,
        executable: options.executable,
        configDir: options.env.CLAUDE_CONFIG_DIR,
      });
      if (args[1] === "login") connected = true;
      if (args[1] === "logout") connected = false;
      return {
        exitCode: 0,
        stderr: "",
        stdout:
          args[1] === "status"
            ? JSON.stringify({
                loggedIn: connected,
                authMethod: connected ? "claude.ai" : "none",
                email: connected ? "person@example.test" : undefined,
                subscriptionType: connected ? "pro" : undefined,
              })
            : "",
      };
    };
    const connection = new ClaudeSubscriptionConnection({
      claudeHome,
      executable: "/test/claude",
      run,
      env: { PATH: "/test/bin", ANTHROPIC_API_KEY: "metered-key" },
    });

    expect(await connection.account()).toEqual({ account: null });
    await connection.login();
    expect(await connection.account()).toEqual({
      account: {
        email: "person@example.test",
        subscriptionType: "pro",
      },
    });
    expect(connection.models().map((model) => model.id)).toEqual([
      "sonnet",
      "opus",
      "haiku",
    ]);
    await connection.logout();
    expect(await connection.account()).toEqual({ account: null });
    expect(calls.every((call) => call.executable === "/test/claude")).toBe(
      true,
    );
    expect(calls.every((call) => call.configDir === claudeHome)).toBe(true);
    expect(connection.runtime().env.ANTHROPIC_API_KEY).toBeUndefined();
    rmSync(claudeHome, { recursive: true, force: true });
  });

  test("runs a recipe with Springroll tools, limits, usage, and subscription billing", async () => {
    let toolHandler:
      | ((input: {
          readonly tool: string;
          readonly arguments: Record<string, unknown>;
        }) => Promise<unknown>)
      | undefined;
    let observedOptions: Record<string, unknown> | undefined;
    const createMcpServer = ((options: {
      readonly tools?: Array<{
        readonly handler: typeof toolHandler extends (
          ...args: never[]
        ) => unknown
          ? typeof toolHandler
          : never;
      }>;
    }) => {
      toolHandler = options.tools?.[0]?.handler as typeof toolHandler;
      return { type: "sdk", name: "springroll" };
    }) as unknown as typeof createSdkMcpServer;
    const startQuery = ((params: {
      readonly options: Record<string, unknown>;
    }) => {
      observedOptions = params.options;
      return (async function* () {
        await toolHandler?.({
          tool: "read_digest",
          arguments: { day: "today" },
        });
        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "## Result\n\nDigest ready." }],
          },
        } as unknown as SDKMessage;
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "## Result\n\nDigest ready.",
          modelUsage: {
            "claude-sonnet": {
              inputTokens: 10,
              outputTokens: 5,
              thinkingTokens: 2,
              cacheReadInputTokens: 4,
              cacheCreationInputTokens: 3,
              webSearchRequests: 0,
              costUSD: 0.01,
              contextWindow: 200_000,
              maxOutputTokens: 64_000,
            },
          },
        } as unknown as SDKMessage;
      })();
    }) as unknown as typeof query;
    const calls: unknown[] = [];
    const runner = new ClaudeAgentRunner("sonnet", {
      query: startQuery,
      createMcpServer,
      executable: "/test/claude",
      env: { CLAUDE_CONFIG_DIR: "/test/config" },
      maxSteps: 10,
    });
    const request: AgentRunRequest = {
      runId: "run-claude",
      task: {
        id: "task-claude",
        prompt: "Make the digest",
        enabled: true,
        nextRunAt: new Date("2026-09-04T12:00:00Z"),
        catchUpPolicy: "skip_to_next",
        tools: [],
      },
      tools: [
        {
          descriptor: {
            name: "read_digest",
            description: "Read the digest",
            inputSchema: { type: "object" },
          },
          policy: {
            sourceId: "test",
            connectionId: "test",
            name: "read_digest",
            inputSchemaHash: "hash",
            risk: { effect: "read", openWorld: false, idempotent: true },
            approval: "never",
          },
          async execute(input) {
            calls.push(input);
            return { content: [{ stories: 3 }] };
          },
        },
      ],
    };

    const result = await runner.run(request);

    expect(calls).toEqual([{ day: "today" }]);
    expect(result.result.body.content).toBe("## Result\n\nDigest ready.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.usage).toEqual({
      provider: "claude",
      modelId: "sonnet",
      billing: "subscription",
      inputTokens: 13,
      cachedInputTokens: 4,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 22,
      webSearchRequests: 0,
    });
    expect(observedOptions).toEqual(
      expect.objectContaining({
        maxTurns: 10,
        model: "sonnet",
        pathToClaudeCodeExecutable: "/test/claude",
        tools: [],
        allowedTools: ["mcp__springroll__call"],
        strictMcpConfig: true,
        persistSession: false,
      }),
    );
  });
});
