ALTER TABLE `run_artifacts` RENAME TO `artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`chat_turn_id` text,
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
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_turn_id`) REFERENCES `chat_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifacts_one_owner" CHECK(("run_id" IS NOT NULL) <> ("chat_turn_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_artifacts`("id", "run_id", "chat_turn_id", "capture_key", "sha256", "media_type", "byte_size", "width", "height", "title", "alt", "provider_id", "model_id", "created_at") SELECT "id", "run_id", NULL, "capture_key", "sha256", "media_type", "byte_size", "width", "height", "title", "alt", "provider_id", "model_id", "created_at" FROM `artifacts`;--> statement-breakpoint
DROP TABLE `artifacts`;--> statement-breakpoint
ALTER TABLE `__new_artifacts` RENAME TO `artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_run_capture_unique` ON `artifacts` (`run_id`,`capture_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_chat_turn_capture_unique` ON `artifacts` (`chat_turn_id`,`capture_key`);--> statement-breakpoint
CREATE INDEX `artifacts_run_idx` ON `artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `artifacts_chat_turn_idx` ON `artifacts` (`chat_turn_id`);--> statement-breakpoint
CREATE INDEX `artifacts_sha_idx` ON `artifacts` (`sha256`);
