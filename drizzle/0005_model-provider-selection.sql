CREATE TABLE `model_provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`catalog_provider_id` text NOT NULL,
	`credential_ref` text NOT NULL,
	`available_in` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_provider_catalog_unique` ON `model_provider_connections` (`catalog_provider_id`);--> statement-breakpoint
CREATE TABLE `model_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`model_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `model_provider_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `model_id` text;