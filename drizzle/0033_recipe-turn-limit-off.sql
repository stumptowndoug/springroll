PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_execution_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`max_steps` integer DEFAULT 0 NOT NULL,
	`max_cost_usd_micros` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_execution_settings`("id", "max_steps", "max_cost_usd_micros", "created_at", "updated_at") SELECT "id", "max_steps", "max_cost_usd_micros", "created_at", "updated_at" FROM `execution_settings`;--> statement-breakpoint
DROP TABLE `execution_settings`;--> statement-breakpoint
ALTER TABLE `__new_execution_settings` RENAME TO `execution_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;