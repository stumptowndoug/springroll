ALTER TABLE `connections` ADD `name` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `name` text;
