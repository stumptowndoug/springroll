CREATE TABLE `execution_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`max_steps` integer DEFAULT 20 NOT NULL,
	`max_cost_usd_micros` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
