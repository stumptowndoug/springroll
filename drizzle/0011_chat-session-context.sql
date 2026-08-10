ALTER TABLE `chat_sessions` ADD `context` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `context_key` text;--> statement-breakpoint
CREATE INDEX `chat_sessions_context_idx` ON `chat_sessions` (`status`,`context_key`,`updated_at`);