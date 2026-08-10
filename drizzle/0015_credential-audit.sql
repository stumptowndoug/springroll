CREATE TABLE `credential_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`credential_kind` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`failure_category` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credential_audit_connector_created_idx` ON `credential_audit_events` (`connector_id`,`created_at`);