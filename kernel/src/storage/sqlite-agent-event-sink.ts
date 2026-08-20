import { desc, eq } from "drizzle-orm";
import {
  type AgentEventPayloadV1,
  type AgentEventSink,
  type AgentEventV1,
  parseAgentEventV1,
} from "../agent-events.ts";
import type { AppDatabase } from "./database.ts";
import { runEvents, runs } from "./schema.ts";

export class SqliteAgentEventSink implements AgentEventSink {
  readonly #runId: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: AppDatabase,
    runId: string,
  ) {
    this.#runId = runId;
  }

  append(
    payload: AgentEventPayloadV1,
    occurredAt: Date,
  ): Promise<AgentEventV1> {
    const operation = this.#pending.then(() => {
      const latest = this.db
        .select({ sequence: runEvents.sequence })
        .from(runEvents)
        .where(eq(runEvents.runId, this.#runId))
        .orderBy(desc(runEvents.sequence))
        .limit(1)
        .get();
      const event = parseAgentEventV1({
        ...payload,
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        runId: this.#runId,
        sequence: (latest?.sequence ?? -1) + 1,
        occurredAt: occurredAt.toISOString(),
      });

      this.db
        .insert(runEvents)
        .values({
          id: event.eventId,
          runId: event.runId,
          sequence: event.sequence,
          type: event.type,
          payload: event,
          createdAt: occurredAt,
        })
        .run();
      this.project(event);
      return event;
    });

    this.#pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private project(event: AgentEventV1): void {
    if (event.type === "model_selection") {
      this.db
        .update(runs)
        .set({
          modelProvider: event.provider,
          modelId: event.modelId,
          modelBilling: event.billing,
          catalogRevision: event.catalogRevision,
          inputUsdPerMillionTokens: event.inputUsdPerMillionTokens,
          outputUsdPerMillionTokens: event.outputUsdPerMillionTokens,
        })
        .where(eq(runs.id, this.#runId))
        .run();
      return;
    }
    if (event.type !== "usage") {
      return;
    }

    const current = this.db
      .select({
        modelProvider: runs.modelProvider,
        modelId: runs.modelId,
        inputTokens: runs.inputTokens,
        outputTokens: runs.outputTokens,
        reasoningTokens: runs.reasoningTokens,
        cachedInputTokens: runs.cachedInputTokens,
        totalTokens: runs.totalTokens,
        costUsdMicros: runs.costUsdMicros,
        actualCostUsdMicros: runs.actualCostUsdMicros,
        estimatedCostUsdMicros: runs.estimatedCostUsdMicros,
        costSource: runs.costSource,
        webSearchRequests: runs.webSearchRequests,
      })
      .from(runs)
      .where(eq(runs.id, this.#runId))
      .get();
    if (!current) {
      return;
    }

    const actualCostUsdMicros = addOptional(
      current.actualCostUsdMicros,
      event.actualCostUsdMicros,
    );
    const estimatedCostUsdMicros = addOptional(
      current.estimatedCostUsdMicros,
      event.estimatedCostUsdMicros,
    );
    const eventUsesEstimate =
      event.actualCostUsdMicros === undefined &&
      (event.estimatedCostUsdMicros !== undefined ||
        event.costSource === "catalog_estimate");
    const costSource =
      eventUsesEstimate || current.costSource === "catalog_estimate"
        ? "catalog_estimate"
        : event.actualCostUsdMicros !== undefined ||
            current.costSource === "provider_reported"
          ? "provider_reported"
          : current.costSource;

    this.db
      .update(runs)
      .set({
        modelProvider: current.modelProvider ?? event.provider,
        modelId: current.modelId ?? event.modelId,
        modelBilling: event.billing,
        inputTokens: addOptional(current.inputTokens, event.inputTokens),
        outputTokens: addOptional(current.outputTokens, event.outputTokens),
        reasoningTokens: addOptional(
          current.reasoningTokens,
          event.reasoningTokens,
        ),
        cachedInputTokens: addOptional(
          current.cachedInputTokens,
          event.cachedInputTokens,
        ),
        totalTokens: addOptional(current.totalTokens, event.totalTokens),
        actualCostUsdMicros,
        estimatedCostUsdMicros,
        costSource,
        costUsdMicros: addOptional(
          current.costUsdMicros,
          event.costUsdMicros ??
            event.actualCostUsdMicros ??
            event.estimatedCostUsdMicros,
        ),
        webSearchRequests: addOptional(
          current.webSearchRequests,
          event.webSearchRequests,
        ),
      })
      .where(eq(runs.id, this.#runId))
      .run();
  }
}

function addOptional(
  current: number | null,
  increment: number | undefined,
): number | null {
  return increment === undefined ? current : (current ?? 0) + increment;
}
