CREATE TABLE `run_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`capture_key` text NOT NULL,
	`sha256` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`title` text DEFAULT 'Generated image' NOT NULL,
	`alt` text,
	`provider_id` text,
	`model_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_artifacts_run_capture_unique` ON `run_artifacts` (`run_id`,`capture_key`);--> statement-breakpoint
CREATE INDEX `run_artifacts_run_idx` ON `run_artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `run_artifacts_sha_idx` ON `run_artifacts` (`sha256`);