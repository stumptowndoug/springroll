ALTER TABLE `task_tools` ADD `max_calls_per_run` integer DEFAULT 8 NOT NULL;--> statement-breakpoint
UPDATE `task_tools` SET `max_calls_per_run` = 2 WHERE `source_id` = 'native.web' AND `name` = 'search_web';--> statement-breakpoint
ALTER TABLE `tasks` ADD `max_tool_calls_per_run` integer DEFAULT 12 NOT NULL;
