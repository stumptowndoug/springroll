CREATE TABLE `tool_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`context_kind` text NOT NULL,
	`context_id` text NOT NULL,
	`message_id` text,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`input` text NOT NULL,
	`risk_effect` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`outcome` text,
	`decided_at` integer,
	`execution_started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_approvals_context_call_unique` ON `tool_approvals` (`context_kind`,`context_id`,`tool_call_id`);--> statement-breakpoint
CREATE INDEX `tool_approvals_context_idx` ON `tool_approvals` (`context_kind`,`context_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tool_approvals_status_idx` ON `tool_approvals` (`status`,`updated_at`);