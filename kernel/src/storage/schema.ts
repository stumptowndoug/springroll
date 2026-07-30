import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ExecutionLocation } from "../contracts.ts";
import type { JsonObject } from "../tools.ts";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    prompt: text("prompt").notNull(),
    schedule: text("schedule").notNull(),
    scheduleTimezone: text("schedule_timezone").notNull().default("UTC"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    catchUpPolicy: text("catch_up_policy", {
      enum: ["catch_up", "skip_to_next"],
    })
      .notNull()
      .default("skip_to_next"),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (table) => [index("tasks_due_idx").on(table.enabled, table.nextRunAt)],
);

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    credentialRef: text("credential_ref").notNull(),
    availableIn: text("available_in", { mode: "json" })
      .$type<ExecutionLocation[]>()
      .notNull(),
    ...timestamps,
  },
  (table) => [index("connections_source_idx").on(table.sourceId)],
);

export const taskTools = sqliteTable(
  "task_tools",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    name: text("name").notNull(),
    inputSchemaHash: text("input_schema_hash").notNull(),
    riskEffect: text("risk_effect", {
      enum: ["read", "write", "destructive"],
    }).notNull(),
    riskOpenWorld: integer("risk_open_world", { mode: "boolean" }).notNull(),
    riskIdempotent: integer("risk_idempotent", {
      mode: "boolean",
    }).notNull(),
    approval: text("approval", {
      enum: ["never", "before_call"],
    }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    primaryKey({
      columns: [table.taskId, table.connectionId, table.name],
    }),
    index("task_tools_task_idx").on(table.taskId),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    scheduledTime: integer("scheduled_time", {
      mode: "timestamp_ms",
    }).notNull(),
    status: text("status", {
      enum: ["claimed", "running", "succeeded", "failed"],
    })
      .notNull()
      .default("claimed"),
    executionLocation: text("execution_location", {
      enum: ["local", "hosted"],
    }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    transcriptSummary: text("transcript_summary"),
    transcriptBody: text("transcript_body"),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsdMicros: integer("cost_usd_micros"),
    error: text("error"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("runs_task_occurrence_unique").on(
      table.taskId,
      table.scheduledTime,
    ),
    index("runs_task_time_idx").on(table.taskId, table.scheduledTime),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type", {
      enum: [
        "run_started",
        "stub_output",
        "tool_call",
        "agent_output",
        "run_succeeded",
        "run_failed",
      ],
    }).notNull(),
    payload: text("payload", { mode: "json" }).$type<JsonObject>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("run_events_run_sequence_unique").on(
      table.runId,
      table.sequence,
    ),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskToolRow = typeof taskTools.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
