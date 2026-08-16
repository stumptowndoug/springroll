CREATE TABLE `chat_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `chat_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_tool_calls_turn_call_unique` ON `chat_tool_calls` (`turn_id`,`tool_call_id`);--> statement-breakpoint
CREATE INDEX `chat_tool_calls_turn_started_idx` ON `chat_tool_calls` (`turn_id`,`started_at`);