CREATE TABLE `task_execution_profiles` (
	`task_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`profile` text NOT NULL,
	`source_run_id` text,
	`stale_reason` text,
	`approved_at` integer,
	`validated_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`task_id`, `revision`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_execution_profiles_task_status_idx` ON `task_execution_profiles` (`task_id`,`status`);