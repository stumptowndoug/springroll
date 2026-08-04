CREATE TABLE `assistant_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`source_tool_call_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`outcome` text,
	`subject_kind` text,
	`subject_id` text,
	`error` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_workflows_source_unique` ON `assistant_workflows` (`session_id`,`source_tool_call_id`);--> statement-breakpoint
CREATE INDEX `assistant_workflows_session_updated_idx` ON `assistant_workflows` (`session_id`,`updated_at`);