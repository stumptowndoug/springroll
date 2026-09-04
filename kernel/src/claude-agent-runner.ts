import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSdkMcpServer,
  type ModelUsage,
  query,
  type SDKAssistantMessage,
  type SDKResultMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentEventSink } from "./agent-events.ts";
import type { RunModelUsage, RunTaskResult } from "./contracts.ts";
import { runSystemPrompt, visualBlocks } from "./prompts.ts";
import { createMarkdownRunResult } from "./run-results.ts";
import {
  type AgentRunner,
  type AgentRunRequest,
  agentRunTemporalContext,
} from "./run-task.ts";
import { summarizeToolOutput } from "./tool-result-summary.ts";
import type {
  ExecutableTool,
  JsonObject,
  JsonValue,
  ToolResult,
} from "./tools.ts";

type StartClaudeQuery = typeof query;
type CreateClaudeMcpServer = typeof createSdkMcpServer;

export interface ClaudeAgentRunnerOptions {
  readonly executable?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly system?: string;
  readonly maxSteps?: number;
  readonly emitModelSelection?: boolean;
  readonly query?: StartClaudeQuery;
  readonly createMcpServer?: CreateClaudeMcpServer;
  readonly surface?: "recipe" | "chat";
}

/** Runs recipes through Claude Agent SDK using a signed-in Claude plan. */
export class ClaudeAgentRunner implements AgentRunner {
  readonly #executable: string | undefined;
  readonly #env: NodeJS.ProcessEnv | undefined;
  readonly #now: () => Date;
  readonly #system: string;
  readonly #maxSteps: number | undefined;
  readonly #emitModelSelection: boolean;
  readonly #query: StartClaudeQuery;
  readonly #createMcpServer: CreateClaudeMcpServer;
  readonly #surface: "recipe" | "chat";

  constructor(
    private readonly modelId: string,
    options: ClaudeAgentRunnerOptions = {},
  ) {
    this.#executable = options.executable;
    this.#env = options.env;
    this.#now = options.now ?? (() => new Date());
    this.#system = options.system ?? `${runSystemPrompt}\n\n${visualBlocks}`;
    this.#maxSteps = options.maxSteps;
    this.#emitModelSelection = options.emitModelSelection ?? true;
    this.#query = options.query ?? query;
    this.#createMcpServer = options.createMcpServer ?? createSdkMcpServer;
    this.#surface = options.surface ?? "recipe";
  }

  async run(request: AgentRunRequest): Promise<RunTaskResult> {
    if (request.continuation) {
      throw new Error(
        "Claude subscription runs do not support Springroll approval continuations yet",
      );
    }
    const startedAt = this.#now();
    const workingDirectory = mkdtempSync(join(tmpdir(), "springroll-claude-"));
    const abortController = new AbortController();
    const relayAbort = () => abortController.abort(request.signal?.reason);
    const toolCalls: RunTaskResult["toolCalls"][number][] = [];
    let modelTurns = 0;

    await emit(
      request.eventSink,
      { type: "lifecycle", phase: "started" },
      startedAt,
    );
    if (this.#emitModelSelection) {
      await emit(
        request.eventSink,
        {
          type: "model_selection",
          provider: "claude",
          modelId: this.modelId,
          billing: "subscription",
          ...(this.#maxSteps ? { maxSteps: this.#maxSteps } : undefined),
        },
        startedAt,
      );
    }

    const springrollTool = tool(
      "call",
      toolInstructions(request.tools),
      {
        tool: z.string().min(1),
        arguments: z.record(z.string(), jsonValueSchema).default({}),
      },
      async (input) =>
        executeSpringrollTool(request, input, toolCalls, this.#now),
      { alwaysLoad: true },
    );
    const springrollServer = this.#createMcpServer({
      name: "springroll",
      version: "0.0.0",
      instructions:
        this.#surface === "chat"
          ? "Use these Springroll application tools when they help answer the conversation. Return a substantive response after gathering evidence."
          : "Use these application tools for the recipe. Return a substantive Markdown report after gathering evidence.",
      tools: [springrollTool],
      alwaysLoad: true,
    });

    if (request.signal?.aborted) relayAbort();
    request.signal?.addEventListener("abort", relayAbort, { once: true });

    try {
      const messages = this.#query({
        prompt: request.task.prompt,
        options: {
          abortController,
          cwd: workingDirectory,
          model: this.modelId,
          systemPrompt: [
            this.#system,
            this.#surface === "recipe"
              ? agentRunTemporalContext(request, startedAt).instructions
              : `The host clock is authoritative. Current time: ${startedAt.toISOString()}.`,
            this.#surface === "recipe"
              ? recipeContextInstructions(request)
              : "",
            this.#maxSteps
              ? `You have at most ${this.#maxSteps} model turns. Finish with the best complete ${this.#surface === "chat" ? "response" : "Markdown report"} before the limit.`
              : "",
          ].filter(Boolean),
          tools: [],
          allowedTools: ["mcp__springroll__call"],
          mcpServers: { springroll: springrollServer },
          strictMcpConfig: true,
          settingSources: [],
          settings: { disableAllHooks: true },
          permissionMode: "dontAsk",
          permissionPrompts: "none",
          persistSession: false,
          ...(this.#maxSteps ? { maxTurns: this.#maxSteps } : undefined),
          ...(this.#executable
            ? { pathToClaudeCodeExecutable: this.#executable }
            : undefined),
          ...(this.#env ? { env: this.#env } : undefined),
        },
      });
      let outcome: SDKResultMessage | undefined;
      let lastAssistantText = "";
      for await (const message of messages) {
        if (message.type === "assistant") {
          modelTurns += 1;
          lastAssistantText = assistantText(message) || lastAssistantText;
          const occurredAt = this.#now();
          await emit(
            request.eventSink,
            {
              type: "model_turn",
              turnId: `${request.runId}:claude:${modelTurns}`,
              step: modelTurns - 1,
              phase: "completed",
              provider: "claude",
              modelId: this.modelId,
            },
            occurredAt,
          );
        }
        if (message.type === "result") outcome = message;
      }
      if (!outcome) throw new Error("Claude finished without a result");
      if (outcome.subtype !== "success" || outcome.is_error) {
        throw new Error(claudeResultError(outcome));
      }
      const finalResponse = outcome.result.trim() || lastAssistantText.trim();
      if (!finalResponse) {
        throw new Error(
          `Claude finished without a substantive ${this.#surface === "chat" ? "response" : "Markdown report"}`,
        );
      }
      const finishedAt = this.#now();
      const usage = toRunUsage(this.modelId, outcome.modelUsage);
      await emit(
        request.eventSink,
        {
          type: "message",
          messageId: `${request.runId}:assistant`,
          role: "assistant",
          parts: [{ type: "text", text: finalResponse }],
        },
        finishedAt,
      );
      await emit(
        request.eventSink,
        {
          type: "usage",
          modelCallId: `${request.runId}:claude`,
          ...usage,
        },
        finishedAt,
      );
      await emit(
        request.eventSink,
        { type: "lifecycle", phase: "completed" },
        finishedAt,
      );
      return {
        result: createMarkdownRunResult({
          body: finalResponse,
          fallbackSummary: request.task.prompt,
        }),
        toolCalls,
        usage,
        startedAt,
        finishedAt,
      };
    } catch (error) {
      await emit(
        request.eventSink,
        {
          type: "lifecycle",
          phase: request.signal?.aborted ? "cancelled" : "failed",
          message: errorMessage(error),
        },
        this.#now(),
      );
      throw error;
    } finally {
      request.signal?.removeEventListener("abort", relayAbort);
      abortController.abort();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  }
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

async function executeSpringrollTool(
  request: AgentRunRequest,
  input: { readonly tool: string; readonly arguments: JsonObject },
  toolCalls: RunTaskResult["toolCalls"][number][],
  now: () => Date,
) {
  const executable = request.tools.find(
    (candidate) => candidate.descriptor.name === input.tool,
  );
  const toolCallId = `${request.runId}:claude-tool:${toolCalls.length + 1}`;
  if (!executable) {
    return mcpError(`Unknown Springroll tool: ${input.tool}`);
  }
  if (executable.policy.approval === "before_call") {
    return mcpError(
      `${executable.descriptor.name} requires approval; Claude subscription approval continuation is not available yet`,
    );
  }
  const toolStartedAt = now();
  await emit(
    request.eventSink,
    {
      type: "policy_decision",
      decision: "allowed",
      reason: `${executable.descriptor.name} is pinned to this task and does not require per-call approval`,
      toolCallId,
      ruleId: "pinned-tool-allowed",
    },
    toolStartedAt,
  );
  await emit(
    request.eventSink,
    {
      type: "tool_call",
      toolCallId,
      toolName: executable.descriptor.name,
      sourceId: executable.policy.sourceId,
      input: input.arguments,
      effect: executable.policy.risk.effect,
      openWorld: executable.policy.risk.openWorld,
      approval: executable.policy.approval,
    },
    toolStartedAt,
  );
  try {
    const result = await executable.execute(input.arguments, {
      taskId: request.task.id,
      runId: request.runId,
      toolCallId,
      ...(request.signal ? { signal: request.signal } : undefined),
    });
    const finishedAt = now();
    const outputSummary = summarizeToolOutput(result);
    toolCalls.push({
      toolName: executable.descriptor.name,
      input: input.arguments,
      status: "succeeded",
      startedAt: toolStartedAt,
      finishedAt,
      ...(outputSummary ? { outputSummary } : undefined),
    });
    const output = toolResultValue(result);
    await emit(
      request.eventSink,
      {
        type: "tool_result",
        toolCallId,
        status: "succeeded",
        output,
        ...(outputSummary ? { outputSummary } : undefined),
      },
      finishedAt,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
    };
  } catch (error) {
    const finishedAt = now();
    const message = errorMessage(error);
    toolCalls.push({
      toolName: executable.descriptor.name,
      input: input.arguments,
      status: "failed",
      startedAt: toolStartedAt,
      finishedAt,
      error: message,
    });
    await emit(
      request.eventSink,
      { type: "tool_result", toolCallId, status: "failed", error: message },
      finishedAt,
    );
    return mcpError(message);
  }
}

function toolInstructions(tools: readonly ExecutableTool[]): string {
  if (tools.length === 0) {
    return "No Springroll tools are available for this recipe.";
  }
  return [
    "Call one pinned Springroll tool by its exact name and pass its arguments object.",
    ...tools.map(
      (item) =>
        `${item.descriptor.name}: ${item.descriptor.description}\nInput schema: ${JSON.stringify(item.descriptor.inputSchema)}`,
    ),
  ].join("\n\n");
}

function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function assistantText(message: SDKAssistantMessage): string {
  const content = message.message.content;
  if (typeof content === "string") return content;
  return content
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

function claudeResultError(result: SDKResultMessage): string {
  if (result.subtype === "success") return result.result || "Claude run failed";
  return (
    result.errors.filter(Boolean).join("; ") ||
    (result.subtype === "error_max_turns"
      ? "Claude reached the configured turn limit before finishing"
      : "Claude run failed")
  );
}

function toRunUsage(
  modelId: string,
  usageByModel: Readonly<Record<string, ModelUsage>>,
): RunModelUsage & { readonly billing: "subscription" } {
  const usages = Object.values(usageByModel);
  const inputTokens = usages.reduce(
    (sum, usage) => sum + usage.inputTokens + usage.cacheCreationInputTokens,
    0,
  );
  const cachedInputTokens = usages.reduce(
    (sum, usage) => sum + usage.cacheReadInputTokens,
    0,
  );
  const outputTokens = usages.reduce(
    (sum, usage) => sum + usage.outputTokens,
    0,
  );
  const reasoningTokens = usages.reduce(
    (sum, usage) => sum + (usage.thinkingTokens ?? 0),
    0,
  );
  return {
    provider: "claude",
    modelId,
    billing: "subscription",
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: inputTokens + cachedInputTokens + outputTokens,
    webSearchRequests: usages.reduce(
      (sum, usage) => sum + usage.webSearchRequests,
      0,
    ),
  };
}

function toolResultValue(result: ToolResult): JsonObject {
  return {
    content: result.content,
    ...(result.structuredContent
      ? { structuredContent: result.structuredContent }
      : undefined),
  };
}

function recipeContextInstructions(request: AgentRunRequest): string {
  return request.recipeContext
    ? `Recipe context from Springroll:\n${JSON.stringify(request.recipeContext)}`
    : "";
}

async function emit(
  sink: AgentEventSink | undefined,
  event: Parameters<AgentEventSink["append"]>[0],
  occurredAt: Date,
): Promise<void> {
  await sink?.append(event, occurredAt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
