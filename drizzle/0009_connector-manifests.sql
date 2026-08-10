CREATE TABLE `integration_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`manifest` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `manifest_id` text;--> statement-breakpoint
CREATE INDEX `connections_manifest_idx` ON `connections` (`manifest_id`);--> statement-breakpoint
INSERT INTO `integration_manifests` (`id`, `manifest`)
SELECT
	'neon',
	json_object(
		'id', 'neon',
		'name', 'Neon',
		'blurb', '<b>Postgres</b> — manage Neon projects and databases.',
		'transport', json_object(
			'kind', 'mcp-remote',
			'endpoint', coalesce(json_extract(`config`, '$.url'), 'https://mcp.neon.tech/mcp')
		),
		'credential', json(
			CASE
				WHEN `credential_ref` = 'none' THEN json_object('kind', 'none')
				ELSE json_object(
					'kind', 'api-key',
					'placeholder', 'Your Neon API key',
					'keyCreationUrl', 'https://console.neon.tech/app/settings/api-keys'
				)
			END
		),
		'probe', json_object('tool', 'list_projects', 'input', json('{}'))
	)
FROM `connections`
WHERE `source_id` = 'mcp.neon'
LIMIT 1;--> statement-breakpoint
UPDATE `connections`
SET
	`source_id` = 'mcp-remote',
	`manifest_id` = 'neon',
	`available_in` = '["local","hosted"]'
WHERE `source_id` = 'mcp.neon';--> statement-breakpoint
UPDATE `task_tools`
SET `source_id` = 'mcp-remote'
WHERE `source_id` = 'mcp.neon';
