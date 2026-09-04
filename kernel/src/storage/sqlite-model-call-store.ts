import { and, asc, eq, max } from "drizzle-orm";
import {
  type ModelCallContextKind,
  type ModelCallStatus,
  modelCallContextKindSchema,
  modelCallStatusSchema,
} from "../assistant.ts";
import type { AppDatabase } from "./database.ts";
import { type ModelCallRow, modelCalls } from "./schema.ts";

export interface RecordModelCallInput {
  readonly id?: string;
  readonly contextKind: ModelCallContextKind;
  readonly contextId: string;
  readonly status: ModelCallStatus;
  readonly provider?: string;
  readonly modelId?: string;
  readonly operation?: "image_generation";
  readonly imageCount?: number;
  readonly billing?: "metered" | "subscription" | "unknown";
  readonly catalogRevision?: string;
  readonly inputUsdPerMillionTokens?: number;
  readonly outputUsdPerMillionTokens?: number;
  readonly finishReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsdMicros?: number;
  readonly actualCostUsdMicros?: number;
  readonly estimatedCostUsdMicros?: number;
  readonly costSource?: "provider_reported" | "catalog_estimate";
  readonly webSearchRequests?: number;
  readonly providerToolCalls?: number;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly error?: string;
}

export interface FinishModelCallInput {
  readonly status: Exclude<ModelCallStatus, "started">;
  readonly finishedAt: Date;
  readonly finishReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsdMicros?: number;
  readonly actualCostUsdMicros?: number;
  readonly estimatedCostUsdMicros?: number;
  readonly costSource?: "provider_reported" | "catalog_estimate";
  readonly webSearchRequests?: number;
  readonly providerToolCalls?: number;
  readonly error?: string;
}

export class SqliteModelCallStore {
  constructor(private readonly db: AppDatabase) {}

  record(input: RecordModelCallInput): ModelCallRow {
    const contextKind = modelCallContextKindSchema.parse(input.contextKind);
    const status = modelCallStatusSchema.parse(input.status);
    const contextId = requiredText(input.contextId, "Model-call context ID");
    validateModelCall(input);

    return this.db.transaction((tx) => {
      const latest = tx
        .select({ sequence: max(modelCalls.sequence) })
        .from(modelCalls)
        .where(
          and(
            eq(modelCalls.contextKind, contextKind),
            eq(modelCalls.contextId, contextId),
          ),
        )
        .get();
      const sequence = (latest?.sequence ?? -1) + 1;
      const id = input.id ?? crypto.randomUUID();
      const finishedAt = input.finishedAt;
      const durationMs = finishedAt
        ? Math.max(0, finishedAt.getTime() - input.startedAt.getTime())
        : undefined;

      tx.insert(modelCalls)
        .values({
          id,
          contextKind,
          contextId,
          sequence,
          status,
          provider: optionalText(input.provider),
          modelId: optionalText(input.modelId),
          operation: input.operation,
          imageCount: input.imageCount,
          billing: input.billing ?? "unknown",
          catalogRevision: optionalText(input.catalogRevision),
          inputUsdPerMillionTokens: input.inputUsdPerMillionTokens,
          outputUsdPerMillionTokens: input.outputUsdPerMillionTokens,
          finishReason: optionalText(input.finishReason),
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          reasoningTokens: input.reasoningTokens,
          cachedInputTokens: input.cachedInputTokens,
          totalTokens: input.totalTokens,
          costUsdMicros: input.costUsdMicros,
          actualCostUsdMicros: input.actualCostUsdMicros,
          estimatedCostUsdMicros: input.estimatedCostUsdMicros,
          costSource: input.costSource,
          webSearchRequests: input.webSearchRequests,
          providerToolCalls: input.providerToolCalls,
          startedAt: input.startedAt,
          finishedAt,
          durationMs,
          error: optionalText(input.error),
        })
        .run();

      const row = tx
        .select()
        .from(modelCalls)
        .where(eq(modelCalls.id, id))
        .get();
      if (!row) throw new Error(`Model call was not persisted: ${id}`);
      return row;
    });
  }

  list(
    contextKind: ModelCallContextKind,
    contextId: string,
  ): readonly ModelCallRow[] {
    return this.db
      .select()
      .from(modelCalls)
      .where(
        and(
          eq(modelCalls.contextKind, contextKind),
          eq(modelCalls.contextId, contextId),
        ),
      )
      .orderBy(asc(modelCalls.sequence))
      .all();
  }

  finish(id: string, input: FinishModelCallInput): ModelCallRow {
    validateUsage(input);
    return this.db.transaction((tx) => {
      const current = tx
        .select()
        .from(modelCalls)
        .where(eq(modelCalls.id, id))
        .get();
      if (!current) throw new Error(`Unknown model call: ${id}`);
      if (current.status !== "started") {
        throw new Error(`Model call is already terminal: ${id}`);
      }
      if (input.finishedAt < current.startedAt) {
        throw new RangeError("Model call cannot finish before it starts");
      }
      tx.update(modelCalls)
        .set({
          status: input.status,
          finishReason: optionalText(input.finishReason),
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          reasoningTokens: input.reasoningTokens,
          cachedInputTokens: input.cachedInputTokens,
          totalTokens: input.totalTokens,
          costUsdMicros: input.costUsdMicros,
          actualCostUsdMicros: input.actualCostUsdMicros,
          estimatedCostUsdMicros: input.estimatedCostUsdMicros,
          costSource: input.costSource,
          webSearchRequests: input.webSearchRequests,
          providerToolCalls: input.providerToolCalls,
          finishedAt: input.finishedAt,
          durationMs: Math.max(
            0,
            input.finishedAt.getTime() - current.startedAt.getTime(),
          ),
          error: optionalText(input.error),
          updatedAt: input.finishedAt,
        })
        .where(eq(modelCalls.id, id))
        .run();
      const row = tx
        .select()
        .from(modelCalls)
        .where(eq(modelCalls.id, id))
        .get();
      if (!row) throw new Error(`Model call was not persisted: ${id}`);
      return row;
    });
  }
}

function validateModelCall(input: RecordModelCallInput): void {
  validateUsage(input);
  if (input.status === "started" && input.finishedAt) {
    throw new TypeError("A started model call cannot have a finish time");
  }
  if (input.status !== "started" && !input.finishedAt) {
    throw new TypeError("A terminal model call requires a finish time");
  }
  if (input.finishedAt && input.finishedAt < input.startedAt) {
    throw new RangeError("Model call cannot finish before it starts");
  }
}

function validateUsage(
  input: Pick<
    RecordModelCallInput,
    | "inputTokens"
    | "outputTokens"
    | "reasoningTokens"
    | "cachedInputTokens"
    | "totalTokens"
    | "costUsdMicros"
    | "actualCostUsdMicros"
    | "estimatedCostUsdMicros"
    | "webSearchRequests"
    | "providerToolCalls"
    | "imageCount"
  > &
    Partial<
      Pick<
        RecordModelCallInput,
        "inputUsdPerMillionTokens" | "outputUsdPerMillionTokens"
      >
    >,
): void {
  const counts = [
    ["inputTokens", input.inputTokens],
    ["outputTokens", input.outputTokens],
    ["reasoningTokens", input.reasoningTokens],
    ["cachedInputTokens", input.cachedInputTokens],
    ["totalTokens", input.totalTokens],
    ["costUsdMicros", input.costUsdMicros],
    ["actualCostUsdMicros", input.actualCostUsdMicros],
    ["estimatedCostUsdMicros", input.estimatedCostUsdMicros],
    ["webSearchRequests", input.webSearchRequests],
    ["providerToolCalls", input.providerToolCalls],
    ["imageCount", input.imageCount],
  ] as const;
  for (const [name, value] of counts) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new RangeError(`${name} must be a non-negative integer`);
    }
  }
  if (input.imageCount !== undefined && input.imageCount < 1) {
    throw new RangeError("imageCount must be a positive integer");
  }
  const prices = [
    ["inputUsdPerMillionTokens", input.inputUsdPerMillionTokens],
    ["outputUsdPerMillionTokens", input.outputUsdPerMillionTokens],
  ] as const;
  for (const [name, value] of prices) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`${name} must be non-negative`);
    }
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
