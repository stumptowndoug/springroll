import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEventSink } from "./agent-events.ts";
import {
  CodexAppServerClient,
  jsonObject,
  type SpawnCodexAppServer,
} from "./codex-app-server.ts";
import type { RunModelUsage, RunTaskResult } from "./contracts.ts";
import { runSystemPrompt, visualBlocks } from "./prompts.ts";
import { createMarkdownRunResult } from "./run-results.ts";
import {
  type AgentRunner,
  type AgentRunRequest,
  agentRunTemporalContext,
} from "./run-task.ts";
import { summarizeToolOutput } from "./tool-result-summary.ts";
import type { ExecutableTool, JsonObject, ToolResult } from "./tools.ts";

interface CodexTokenUsage {
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
}

export interface CodexAgentRunnerOptions {
  readonly spawn?: SpawnCodexAppServer;
  readonly now?: () => Date;
  readonly system?: string;
  readonly maxSteps?: number;
  readonly emitModelSelection?: boolean;
  readonly surface?: "recipe" | "chat";
}

/**
 * Runs scheduled recipes through Codex app server using the user's ChatGPT
 * subscription. Springroll tools stay client-executed dynamic tools.
 */
export class CodexAgentRunner implements AgentRunner {
  readonly #spawn: SpawnCodexAppServer | undefined;
  readonly #now: () => Date;
  readonly #system: string;
  readonly #maxSteps: number | undefined;
  readonly #emitModelSelection: boolean;
  readonly #surface: "recipe" | "chat";

  constructor(
    private readonly modelId: string,
    options: CodexAgentRunnerOptions = {},
  ) {
    this.#spawn = options.spawn;
    this.#now = options.now ?? (() => new Date());
    this.#system = options.system ?? `${runSystemPrompt}\n\n${visualBlocks}`;
    this.#maxSteps = options.maxSteps;
    this.#emitModelSelection = options.emitModelSelection ?? true;
    this.#surface = options.surface ?? "recipe";
  }

  async run(request: AgentRunRequest): Promise<RunTaskResult> {
    if (request.continuation) {
      throw new Error(
        "Codex subscription runs do not support Springroll approval continuations yet",
      );
    }
    const startedAt = this.#now();
    const workingDirectory = mkdtempSync(join(tmpdir(), "springroll-codex-"));
    const client = new CodexAppServerClient({
      ...(this.#spawn ? { spawn: this.#spawn } : undefined),
    });
    const tools = dynamicTools(request.tools);
    const toolCalls: RunTaskResult["toolCalls"][number][] = [];
    let usage: CodexTokenUsage | undefined;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let finalResponse = "";

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
          provider: "codex",
          modelId: this.modelId,
          billing: "subscription",
        },
        startedAt,
      );
    }

    const stopHandling = client.handleRequests(async (method, params) => {
      if (method !== "item/tool/call") {
        throw new Error(`Unsupported Codex request: ${method}`);
      }
      const call = readDynamicToolCall(params);
      const executable = tools.byName.get(call.tool);
      if (!executable) throw new Error(`Unknown Codex tool: ${call.tool}`);
      if (executable.policy.approval === "before_call") {
        throw new Error(
          `${executable.descriptor.name} requires approval; Codex subscription approval continuation is not available yet`,
        );
      }
      const toolStartedAt = this.#now();
      await emit(
        request.eventSink,
        {
          type: "policy_decision",
          decision: "allowed",
          reason: `${executable.descriptor.name} is pinned to this task and does not require per-call approval`,
          toolCallId: call.callId,
          ruleId: "pinned-tool-allowed",
        },
        toolStartedAt,
      );
      await emit(
        request.eventSink,
        {
          type: "tool_call",
          toolCallId: call.callId,
          toolName: executable.descriptor.name,
          sourceId: executable.policy.sourceId,
          input: call.arguments,
          effect: executable.policy.risk.effect,
          openWorld: executable.policy.risk.openWorld,
          approval: executable.policy.approval,
        },
        toolStartedAt,
      );
      try {
        const result = await executable.execute(call.arguments, {
          taskId: request.task.id,
          runId: request.runId,
          toolCallId: call.callId,
          ...(request.signal ? { signal: request.signal } : undefined),
        });
        const finishedAt = this.#now();
        const outputSummary = summarizeToolOutput(result);
        toolCalls.push({
          toolName: executable.descriptor.name,
          input: call.arguments,
          status: "succeeded",
          startedAt: toolStartedAt,
          finishedAt,
          ...(outputSummary ? { outputSummary } : undefined),
        });
        await emit(
          request.eventSink,
          {
            type: "tool_result",
            toolCallId: call.callId,
            status: "succeeded",
            output: toolResultValue(result),
            ...(outputSummary ? { outputSummary } : undefined),
          },
          finishedAt,
        );
        return {
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify(toolResultValue(result)),
            },
          ],
        };
      } catch (error) {
        const finishedAt = this.#now();
        const message = errorMessage(error);
        toolCalls.push({
          toolName: executable.descriptor.name,
          input: call.arguments,
          status: "failed",
          startedAt: toolStartedAt,
          finishedAt,
          error: message,
        });
        await emit(
          request.eventSink,
          {
            type: "tool_result",
            toolCallId: call.callId,
            status: "failed",
            error: message,
          },
          finishedAt,
        );
        return {
          success: false,
          contentItems: [{ type: "inputText", text: message }],
        };
      }
    });

    try {
      await client.start();
      const account = await client.request<{
        readonly account: { readonly type: string } | null;
      }>("account/read", { refreshToken: true });
      if (account.account?.type !== "chatgpt") {
        throw new Error(
          `Connect a ChatGPT subscription in Models before using Codex for ${this.#surface === "chat" ? "chat" : "a recipe"}`,
        );
      }

      const thread = await client.request<{
        readonly thread: { readonly id: string };
      }>("thread/start", {
        model: this.modelId,
        cwd: workingDirectory,
        sandbox: "read-only",
        approvalPolicy: "never",
        ephemeral: true,
        baseInstructions: this.#system,
        developerInstructions: [
          this.#surface === "recipe"
            ? agentRunTemporalContext(request, startedAt).instructions
            : `The host clock is authoritative. Current time: ${startedAt.toISOString()}.`,
          this.#surface === "recipe" ? recipeContextInstructions(request) : "",
          this.#maxSteps
            ? `Use no more than ${this.#maxSteps} model/tool steps. This is a Springroll limit; finish with the best complete ${this.#surface === "chat" ? "response" : "report"} before reaching it.`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        dynamicTools: tools.specs,
      });
      threadId = thread.thread.id;
      const completed = new Promise<void>((resolve, reject) => {
        const off = client.onNotification((method, params) => {
          const event = params as Record<string, unknown>;
          if (event.threadId !== threadId) return;
          if (method === "thread/tokenUsage/updated") {
            const tokenUsage = event.tokenUsage as
              | { readonly total?: CodexTokenUsage }
              | undefined;
            if (tokenUsage?.total) usage = tokenUsage.total;
          }
          if (method === "item/completed") {
            const item = event.item as
              | { readonly type?: string; readonly text?: string }
              | undefined;
            if (item?.type === "agentMessage" && item.text) {
              finalResponse = item.text;
            }
          }
          if (method === "turn/completed") {
            const turn = event.turn as
              | {
                  readonly id?: string;
                  readonly status?: string;
                  readonly error?: { readonly message?: string };
                }
              | undefined;
            if (!turn || turn.id !== turnId) return;
            off();
            if (turn.status === "failed") {
              reject(new Error(turn.error?.message ?? "Codex turn failed"));
            } else {
              resolve();
            }
          }
        });
      });
      const started = await client.request<{
        readonly turn: { readonly id: string };
      }>("turn/start", {
        threadId,
        input: [{ type: "text", text: request.task.prompt }],
      });
      turnId = started.turn.id;
      const abort = () => {
        if (threadId && turnId) {
          void client.request("turn/interrupt", { threadId, turnId });
        }
      };
      if (request.signal?.aborted) {
        abort();
      } else {
        request.signal?.addEventListener("abort", abort, { once: true });
      }
      try {
        await completed;
      } finally {
        request.signal?.removeEventListener("abort", abort);
      }
      if (!finalResponse.trim()) {
        throw new Error(
          `Codex finished without a substantive ${this.#surface === "chat" ? "response" : "Markdown report"}`,
        );
      }
      const finishedAt = this.#now();
      const normalizedUsage = toRunUsage(this.modelId, usage);
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
          modelCallId: `${request.runId}:codex`,
          ...normalizedUsage,
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
        usage: normalizedUsage,
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
      stopHandling();
      client.close();
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  }
}

function dynamicTools(tools: readonly ExecutableTool[]): {
  readonly specs: readonly {
    readonly type: "function";
    readonly name: string;
    readonly description: string;
    readonly inputSchema: JsonObject;
  }[];
  readonly byName: ReadonlyMap<string, ExecutableTool>;
} {
  const byName = new Map<string, ExecutableTool>();
  const specs = tools.map((tool, index) => {
    const name = `springroll_tool_${index}`;
    byName.set(name, tool);
    return {
      type: "function" as const,
      name,
      description: `${tool.descriptor.name}: ${tool.descriptor.description}`,
      inputSchema: tool.descriptor.inputSchema,
    };
  });
  return { specs, byName };
}

function readDynamicToolCall(params: unknown): {
  readonly callId: string;
  readonly tool: string;
  readonly arguments: JsonObject;
} {
  const value = jsonObject(params);
  if (typeof value.callId !== "string" || typeof value.tool !== "string") {
    throw new TypeError("Codex returned an invalid dynamic tool call");
  }
  return {
    callId: value.callId,
    tool: value.tool,
    arguments: jsonObject(value.arguments),
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

function toRunUsage(
  modelId: string,
  usage: CodexTokenUsage | undefined,
): RunModelUsage & { readonly billing: "subscription" } {
  return {
    provider: "codex",
    modelId,
    billing: "subscription",
    ...(usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningOutputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          totalTokens: usage.totalTokens,
        }
      : undefined),
  };
}

function recipeContextInstructions(request: AgentRunRequest): string {
  const context = request.recipeContext;
  if (!context) return "";
  return `Recipe context from Springroll:\n${JSON.stringify(context)}`;
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
