import { generateText, type LanguageModel } from "ai";
import {
  type AiSdkModelPricing,
  calculateAiSdkCost,
} from "./ai-sdk-agent-runner.ts";
import type { RecordModelCallInput } from "./storage/sqlite-model-call-store.ts";
import type {
  JsonObject,
  JsonValue,
  ToolCallContext,
  ToolResult,
  ToolSource,
} from "./tools.ts";

/**
 * Web tool results are billed into the model context on every subsequent
 * step, so oversized results are distilled once, at execution time, by a
 * cheap dedicated model. The distilled Markdown is what enters the message
 * history; it is never rewritten afterwards, which keeps provider prompt
 * caches warm. When no distiller model is assigned or the call fails, the
 * original (mechanically bounded) result passes through unchanged.
 */
export interface ResearchDistiller {
  distill(call: ResearchDistillerCall): Promise<ToolResult | undefined>;
}

export interface ResearchDistillerCall {
  readonly toolName: string;
  readonly input: JsonObject;
  readonly result: ToolResult;
  readonly context: ToolCallContext;
}

export interface ResearchDistillerRuntime {
  readonly model: LanguageModel;
  readonly provider: string;
  readonly modelId: string;
  readonly billing?: "metered" | "subscription" | "unknown";
  readonly catalogRevision?: string;
  readonly pricing?: AiSdkModelPricing;
}

export interface ModelResearchDistillerOptions {
  readonly loadRuntime: () => Promise<ResearchDistillerRuntime | undefined>;
  readonly recordModelCall?: (input: RecordModelCallInput) => void;
  readonly minimumCharacters?: number;
  readonly maxSummaryTokens?: number;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

export const researchDistillableToolNames: ReadonlySet<string> = new Set([
  "search_web",
  "fetch_public_url",
]);

const defaultMinimumCharacters = 3_000;
const defaultMaxSummaryTokens = 700;
const defaultTimeoutMs = 30_000;

const distillerSystemPrompt = [
  "You are Springroll's research distiller. You receive one raw web tool result gathered during an agent's research, along with the tool input that requested it. Rewrite the result as compact Markdown notes for the agent.",
  "Rules:",
  "- Keep only material relevant to the request; drop navigation, boilerplate, and repetition.",
  "- Preserve exact figures, dates, version numbers, identifiers, and short key quotes verbatim.",
  "- Keep every source URL you rely on and attribute facts to their URL.",
  "- Never add facts that are not present in the input. If the result does not answer the request, say so briefly and list what it does contain.",
  "- Respond with Markdown only, no preamble.",
].join("\n");

export function createModelResearchDistiller(
  options: ModelResearchDistillerOptions,
): ResearchDistiller {
  const minimumCharacters =
    options.minimumCharacters ?? defaultMinimumCharacters;
  const maxSummaryTokens = options.maxSummaryTokens ?? defaultMaxSummaryTokens;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const now = options.now ?? (() => new Date());

  return {
    async distill({ toolName, input, result, context }) {
      const raw = encodedResultText(result);
      if (raw.length < minimumCharacters) return undefined;
      const runtime = await options.loadRuntime();
      if (!runtime) return undefined;

      const startedAt = now();
      try {
        const generated = await generateText({
          model: runtime.model,
          system: distillerSystemPrompt,
          prompt: [
            `Tool: ${toolName}`,
            `Request: ${JSON.stringify(input)}`,
            "",
            "Raw result:",
            raw,
          ].join("\n"),
          maxRetries: 1,
          maxOutputTokens: maxSummaryTokens,
          abortSignal: distillAbortSignal(context.signal, timeoutMs),
        });
        options.recordModelCall?.({
          contextKind: "distill",
          contextId: context.runId,
          status: "succeeded",
          provider: runtime.provider,
          modelId: runtime.modelId,
          billing: runtime.billing ?? "metered",
          ...(runtime.catalogRevision
            ? { catalogRevision: runtime.catalogRevision }
            : undefined),
          ...(runtime.pricing
            ? {
                inputUsdPerMillionTokens:
                  runtime.pricing.inputUsdPerMillionTokens,
                outputUsdPerMillionTokens:
                  runtime.pricing.outputUsdPerMillionTokens,
              }
            : undefined),
          finishReason: generated.finishReason,
          ...(generated.usage.inputTokens === undefined
            ? undefined
            : { inputTokens: generated.usage.inputTokens }),
          ...(generated.usage.outputTokens === undefined
            ? undefined
            : { outputTokens: generated.usage.outputTokens }),
          ...(generated.usage.totalTokens === undefined
            ? undefined
            : { totalTokens: generated.usage.totalTokens }),
          ...calculateAiSdkCost(
            generated.usage,
            runtime.pricing,
            generated.providerMetadata,
          ),
          startedAt,
          finishedAt: now(),
        });

        const summary = generated.text.trim();
        if (!summary) return undefined;
        const distilled = [
          summary,
          `_Distilled by Springroll from a ${raw.length.toLocaleString()}-character ${toolName} result. If a needed detail is missing, call the tool again with an adjusted input or fetch a listed source URL for the full content._`,
        ].join("\n\n");
        if (distilled.length >= raw.length) return undefined;
        return {
          content: [distilled],
          structuredContent: {
            distilled: true,
            originalCharacters: raw.length,
            markdown: distilled,
          },
        };
      } catch (error) {
        options.recordModelCall?.({
          contextKind: "distill",
          contextId: context.runId,
          status: context.signal?.aborted ? "cancelled" : "failed",
          provider: runtime.provider,
          modelId: runtime.modelId,
          billing: runtime.billing ?? "metered",
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          finishedAt: now(),
        });
        if (context.signal?.aborted) throw error;
        return undefined;
      }
    },
  };
}

/**
 * Wrap a tool source so oversized results from the named research tools are
 * distilled before they reach the model loop. Distillation is best-effort:
 * ledger recording failures and distiller errors fall back to the original
 * result rather than failing the tool call.
 */
export function withResearchDistillation(
  source: ToolSource,
  distiller: ResearchDistiller,
  toolNames: ReadonlySet<string> = researchDistillableToolNames,
): ToolSource {
  return {
    id: source.id,
    kind: source.kind,
    async open(options) {
      const session = await source.open(options);
      return {
        listTools: () => session.listTools(),
        close: () => session.close(),
        async callTool(name, input, context) {
          const result = await session.callTool(name, input, context);
          if (!toolNames.has(name)) return result;
          try {
            const distilled = await distiller.distill({
              toolName: name,
              input,
              result,
              context,
            });
            return distilled ?? result;
          } catch (error) {
            if (context.signal?.aborted) throw error;
            return result;
          }
        },
      };
    },
  };
}

function distillAbortSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function encodedResultText(result: ToolResult): string {
  return result.content
    .map((value: JsonValue) =>
      typeof value === "string" ? value : JSON.stringify(value),
    )
    .join("\n\n");
}
