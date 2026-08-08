import { integer, sqliteTable, text } from "rivetkit/db/drizzle";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  summary: text("summary"),
  body: text("body"),
  error: text("error"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsdMicros: integer("cost_usd_micros"),
});

export const runEvents = sqliteTable("run_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  sequence: integer("sequence").notNull(),
  cursor: integer("cursor").notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const runCheckpoints = sqliteTable("run_checkpoints", {
  runId: text("run_id").primaryKey(),
  messages: text("messages", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const schema = { runs, runEvents, runCheckpoints };

export const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    summary TEXT,
    body TEXT,
    error TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd_micros INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    cursor INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS run_events_cursor ON run_events (cursor)`,
  `CREATE TABLE IF NOT EXISTS run_checkpoints (
    run_id TEXT PRIMARY KEY,
    messages TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];
