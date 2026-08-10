CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`parts` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `chat_turns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_session_sequence_unique` ON `chat_messages` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `chat_messages_turn_idx` ON `chat_messages` (`turn_id`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`status` text DEFAULT 'active' NOT NULL,
	`active_turn_id` text,
	`last_message_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_sessions_status_updated_idx` ON `chat_sessions` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_turns_session_created_idx` ON `chat_turns` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`context_kind` text NOT NULL,
	`context_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text NOT NULL,
	`provider` text,
	`model_id` text,
	`billing` text DEFAULT 'unknown' NOT NULL,
	`catalog_revision` text,
	`input_usd_per_million_tokens` real,
	`output_usd_per_million_tokens` real,
	`finish_reason` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`cached_input_tokens` integer,
	`total_tokens` integer,
	`cost_usd_micros` integer,
	`actual_cost_usd_micros` integer,
	`estimated_cost_usd_micros` integer,
	`cost_source` text,
	`web_search_requests` integer,
	`provider_tool_calls` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_calls_context_sequence_unique` ON `model_calls` (`context_kind`,`context_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `model_calls_context_idx` ON `model_calls` (`context_kind`,`context_id`);