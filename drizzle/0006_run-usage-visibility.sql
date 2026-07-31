ALTER TABLE `runs` ADD `model_billing` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `catalog_revision` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `input_usd_per_million_tokens` real;--> statement-breakpoint
ALTER TABLE `runs` ADD `output_usd_per_million_tokens` real;--> statement-breakpoint
ALTER TABLE `runs` ADD `reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `cached_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `actual_cost_usd_micros` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `estimated_cost_usd_micros` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `cost_source` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `web_search_requests` integer;