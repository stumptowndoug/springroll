CREATE TABLE `appearance_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`theme` text,
	`text_size` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
