ALTER TABLE `runs` ADD `manual_request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_task_manual_request_unique` ON `runs` (`task_id`,`manual_request_id`);