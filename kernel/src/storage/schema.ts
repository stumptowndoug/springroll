import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  AssistantWorkflowKind,
  AssistantWorkflowStatus,
  ChatSessionContext,
  ChatSubjectKind,
} from "../assistant.ts";
import type { ConnectorManifest } from "../connector-manifest.ts";
import type { ExecutionLocation, RunResultV1 } from "../contracts.ts";
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
    name: text("name"),
    tag: text("tag"),
    prompt: text("prompt").notNull(),
    schedule: text("schedule").notNull(),
    scheduleTimezone: text("schedule_timezone").notNull().default("UTC"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    catchUpPolicy: text("catch_up_policy", {
      enum: ["catch_up", "skip_to_next"],
    })
      .notNull()
      .default("skip_to_next"),
    modelProviderId: text("model_provider_id"),
    modelId: text("model_id"),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (table) => [index("tasks_due_idx").on(table.enabled, table.nextRunAt)],
);

export const modelProviderConnections = sqliteTable(
  "model_provider_connections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    catalogProviderId: text("catalog_provider_id").notNull(),
    credentialRef: text("credential_ref").notNull(),
    availableIn: text("available_in", { mode: "json" })
      .$type<ExecutionLocation[]>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("model_provider_catalog_unique").on(table.catalogProviderId),
  ],
);

export const modelSettings = sqliteTable("model_settings", {
  id: text("id").primaryKey(),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  ...timestamps,
});

export const integrationManifests = sqliteTable("integration_manifests", {
  id: text("id").primaryKey(),
  manifest: text("manifest", { mode: "json" })
    .$type<ConnectorManifest>()
    .notNull(),
  ...timestamps,
});

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    sourceId: text("source_id").notNull(),
    manifestId: text("manifest_id"),
    credentialRef: text("credential_ref").notNull(),
    config: text("config", { mode: "json" })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    availableIn: text("available_in", { mode: "json" })
      .$type<ExecutionLocation[]>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("connections_source_idx").on(table.sourceId),
    index("connections_manifest_idx").on(table.manifestId),
  ],
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
    manualRequestId: text("manual_request_id"),
    status: text("status", {
      enum: [
        "claimed",
        "running",
        "waiting_for_approval",
        "succeeded",
        "failed",
      ],
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
    resultJson: text("result_json", { mode: "json" }).$type<RunResultV1>(),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    modelBilling: text("model_billing", {
      enum: ["metered", "subscription", "unknown"],
    }),
    catalogRevision: text("catalog_revision"),
    inputUsdPerMillionTokens: real("input_usd_per_million_tokens"),
    outputUsdPerMillionTokens: real("output_usd_per_million_tokens"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    totalTokens: integer("total_tokens"),
    costUsdMicros: integer("cost_usd_micros"),
    actualCostUsdMicros: integer("actual_cost_usd_micros"),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros"),
    costSource: text("cost_source", {
      enum: ["provider_reported", "catalog_estimate"],
    }),
    webSearchRequests: integer("web_search_requests"),
    failureCategory: text("failure_category", {
      enum: [
        "authentication",
        "rate_limit",
        "timeout",
        "network",
        "policy",
        "invalid_response",
        "unknown",
      ],
    }),
    error: text("error"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("runs_task_occurrence_unique").on(
      table.taskId,
      table.scheduledTime,
    ),
    uniqueIndex("runs_task_manual_request_unique").on(
      table.taskId,
      table.manualRequestId,
    ),
    index("runs_task_time_idx").on(table.taskId, table.scheduledTime),
  ],
);

export const runCheckpoints = sqliteTable("run_checkpoints", {
  runId: text("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  messages: text("messages", { mode: "json" })
    .$type<readonly JsonObject[]>()
    .notNull(),
  ...timestamps,
});

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
        "lifecycle",
        "message",
        "source",
        "tool_result",
        "policy_decision",
        "model_selection",
        "model_turn",
        "model_retry",
        "usage",
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

export const chatSessions = sqliteTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    context: text("context", { mode: "json" }).$type<ChatSessionContext>(),
    contextKey: text("context_key"),
    activeTurnId: text("active_turn_id"),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    index("chat_sessions_status_updated_idx").on(table.status, table.updatedAt),
    index("chat_sessions_context_idx").on(
      table.status,
      table.contextKey,
      table.updatedAt,
    ),
  ],
);

export const chatTurns = sqliteTable(
  "chat_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: [
        "queued",
        "streaming",
        "waiting_for_user",
        "completed",
        "failed",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    error: text("error"),
    ...timestamps,
  },
  (table) => [
    index("chat_turns_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    turnId: text("turn_id").references(() => chatTurns.id, {
      onDelete: "set null",
    }),
    sequence: integer("sequence").notNull(),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    parts: text("parts", { mode: "json" })
      .$type<readonly JsonObject[]>()
      .notNull(),
    metadata: text("metadata", { mode: "json" })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("chat_messages_session_sequence_unique").on(
      table.sessionId,
      table.sequence,
    ),
    index("chat_messages_turn_idx").on(table.turnId),
  ],
);

export const assistantWorkflows = sqliteTable(
  "assistant_workflows",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    sourceToolCallId: text("source_tool_call_id").notNull(),
    kind: text("kind").$type<AssistantWorkflowKind>().notNull(),
    status: text("status")
      .$type<AssistantWorkflowStatus>()
      .notNull()
      .default("proposed"),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: text("payload", { mode: "json" }).$type<JsonObject>().notNull(),
    outcome: text("outcome", { mode: "json" }).$type<JsonObject>(),
    subjectKind: text("subject_kind").$type<ChatSubjectKind>(),
    subjectId: text("subject_id"),
    error: text("error"),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("assistant_workflows_source_unique").on(
      table.sessionId,
      table.sourceToolCallId,
    ),
    index("assistant_workflows_session_updated_idx").on(
      table.sessionId,
      table.updatedAt,
    ),
  ],
);

export const toolApprovals = sqliteTable(
  "tool_approvals",
  {
    id: text("id").primaryKey(),
    contextKind: text("context_kind", { enum: ["chat", "run"] }).notNull(),
    contextId: text("context_id").notNull(),
    messageId: text("message_id").references(() => chatMessages.id, {
      onDelete: "set null",
    }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    input: text("input", { mode: "json" }).$type<JsonObject>().notNull(),
    riskEffect: text("risk_effect", {
      enum: ["read", "write", "destructive"],
    }).notNull(),
    status: text("status", {
      enum: [
        "pending",
        "approved",
        "denied",
        "executing",
        "succeeded",
        "failed",
        "interrupted",
      ],
    })
      .notNull()
      .default("pending"),
    reason: text("reason"),
    outcome: text("outcome", { mode: "json" }).$type<JsonObject>(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    executionStartedAt: integer("execution_started_at", {
      mode: "timestamp_ms",
    }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tool_approvals_context_call_unique").on(
      table.contextKind,
      table.contextId,
      table.toolCallId,
    ),
    index("tool_approvals_context_idx").on(
      table.contextKind,
      table.contextId,
      table.createdAt,
    ),
    index("tool_approvals_status_idx").on(table.status, table.updatedAt),
  ],
);

export const credentialAuditEvents = sqliteTable(
  "credential_audit_events",
  {
    id: text("id").primaryKey(),
    connectorId: text("connector_id").notNull(),
    credentialKind: text("credential_kind", {
      enum: ["oauth", "api-key", "none"],
    }).notNull(),
    action: text("action", {
      enum: ["test", "oauth_start", "oauth_complete", "revoke", "remove"],
    }).notNull(),
    status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
    failureCategory: text("failure_category", {
      enum: [
        "authentication",
        "rate_limit",
        "timeout",
        "network",
        "policy",
        "invalid_response",
        "unknown",
      ],
    }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("credential_audit_connector_created_idx").on(
      table.connectorId,
      table.createdAt,
    ),
  ],
);

export const modelCalls = sqliteTable(
  "model_calls",
  {
    id: text("id").primaryKey(),
    contextKind: text("context_kind", {
      enum: ["proposal", "run", "chat"],
    }).notNull(),
    contextId: text("context_id").notNull(),
    sequence: integer("sequence").notNull(),
    status: text("status", {
      enum: ["started", "succeeded", "failed", "cancelled"],
    }).notNull(),
    provider: text("provider"),
    modelId: text("model_id"),
    billing: text("billing", {
      enum: ["metered", "subscription", "unknown"],
    })
      .notNull()
      .default("unknown"),
    catalogRevision: text("catalog_revision"),
    inputUsdPerMillionTokens: real("input_usd_per_million_tokens"),
    outputUsdPerMillionTokens: real("output_usd_per_million_tokens"),
    finishReason: text("finish_reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    totalTokens: integer("total_tokens"),
    costUsdMicros: integer("cost_usd_micros"),
    actualCostUsdMicros: integer("actual_cost_usd_micros"),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros"),
    costSource: text("cost_source", {
      enum: ["provider_reported", "catalog_estimate"],
    }),
    webSearchRequests: integer("web_search_requests"),
    providerToolCalls: integer("provider_tool_calls"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    error: text("error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("model_calls_context_sequence_unique").on(
      table.contextKind,
      table.contextId,
      table.sequence,
    ),
    index("model_calls_context_idx").on(table.contextKind, table.contextId),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type ToolApprovalRow = typeof toolApprovals.$inferSelect;
export type CredentialAuditEventRow = typeof credentialAuditEvents.$inferSelect;
export type TaskToolRow = typeof taskTools.$inferSelect;
export type ModelProviderConnectionRow =
  typeof modelProviderConnections.$inferSelect;
export type IntegrationManifestRow = typeof integrationManifests.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type ChatTurnRow = typeof chatTurns.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type AssistantWorkflowRow = typeof assistantWorkflows.$inferSelect;
export type ModelCallRow = typeof modelCalls.$inferSelect;
