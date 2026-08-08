import type { ModelMessage } from "@ai-sdk/provider-utils";
import { modelMessageSchema } from "ai";
import { eq } from "drizzle-orm";
import type { JsonObject } from "../tools.ts";
import type { AppDatabase } from "./database.ts";
import { runCheckpoints } from "./schema.ts";

const checkpointLimit = 5_000_000;

export class SqliteRunCheckpointStore {
  constructor(private readonly db: AppDatabase) {}

  get(runId: string): readonly ModelMessage[] | undefined {
    const row = this.db
      .select({ messages: runCheckpoints.messages })
      .from(runCheckpoints)
      .where(eq(runCheckpoints.runId, runId))
      .get();
    return row?.messages.map((message) => modelMessageSchema.parse(message));
  }

  save(
    runId: string,
    messages: readonly ModelMessage[],
    now = new Date(),
  ): void {
    const persisted = messages.map((message) =>
      modelMessageSchema.parse(message),
    ) as JsonObject[];
    if (containsPrivateModelData(persisted)) {
      throw new TypeError(
        "Run checkpoint must not contain reasoning or provider metadata",
      );
    }
    if (JSON.stringify(persisted).length > checkpointLimit) {
      throw new TypeError("Run checkpoint exceeds the 5 MB emergency limit");
    }
    this.db
      .insert(runCheckpoints)
      .values({ runId, messages: persisted, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: runCheckpoints.runId,
        set: { messages: persisted, updatedAt: now },
      })
      .run();
  }

  delete(runId: string): void {
    this.db.delete(runCheckpoints).where(eq(runCheckpoints.runId, runId)).run();
  }
}

function containsPrivateModelData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateModelData);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === "reasoning" || record.type === "reasoning-file") {
    return true;
  }
  return Object.entries(record).some(
    ([key, item]) =>
      key === "providerOptions" ||
      key === "providerMetadata" ||
      containsPrivateModelData(item),
  );
}
