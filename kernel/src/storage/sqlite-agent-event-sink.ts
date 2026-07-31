import { desc, eq } from "drizzle-orm";
import {
  type AgentEventPayloadV1,
  type AgentEventSink,
  type AgentEventV1,
  parseAgentEventV1,
} from "../agent-events.ts";
import type { AppDatabase } from "./database.ts";
import { runEvents } from "./schema.ts";

export class SqliteAgentEventSink implements AgentEventSink {
  readonly #runId: string;
  #nextSequence: number;
  #pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: AppDatabase,
    runId: string,
  ) {
    this.#runId = runId;
    const latest = db
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1)
      .get();
    this.#nextSequence = (latest?.sequence ?? -1) + 1;
  }

  append(
    payload: AgentEventPayloadV1,
    occurredAt: Date,
  ): Promise<AgentEventV1> {
    const operation = this.#pending.then(() => {
      const event = parseAgentEventV1({
        ...payload,
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        runId: this.#runId,
        sequence: this.#nextSequence,
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
      this.#nextSequence += 1;
      return event;
    });

    this.#pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
