CREATE TABLE `task_tools` (
	`task_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`input_schema_hash` text NOT NULL,
	`risk_effect` text NOT NULL,
	`risk_open_world` integer NOT NULL,
	`risk_idempotent` integer NOT NULL,
	`approval` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`task_id`, `connection_id`, `name`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_tools_task_idx` ON `task_tools` (`task_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `transcript_summary` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `transcript_body` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `model_provider` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `total_tokens` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `cost_usd_micros` integer;