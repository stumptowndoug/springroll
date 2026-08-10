-- Connector policy is the authoritative approval boundary. Preserve the most
-- permissive legacy recipe grant unless a tool was only ever turned off.
UPDATE `connections`
SET `config` = json_set(
  `config`,
  '$.toolPolicies',
  json(COALESCE((
    SELECT json_group_object(`name`, `mode`)
    FROM (
      SELECT
        `name`,
        CASE
          WHEN MAX(CASE WHEN `approval` = 'never' THEN 1 ELSE 0 END) = 1 THEN 'allow'
          WHEN MAX(CASE WHEN `approval` = 'before_call' THEN 1 ELSE 0 END) = 1 THEN 'check_first'
          ELSE 'off'
        END AS `mode`
      FROM `task_tools`
      WHERE `connection_id` = `connections`.`id`
      GROUP BY `name`
    )
  ), '{}'))
);
--> statement-breakpoint
-- Neon's trusted connector describes when OAuth has enforced read-only mode,
-- even though its generic run_sql annotation remains destructive.
UPDATE `connections`
SET `config` = json_set(`config`, '$.accessMode', 'read_only')
WHERE `manifest_id` = 'neon'
  AND EXISTS (
    SELECT 1
    FROM json_each(`connections`.`config`, '$.discoveredTools')
    WHERE lower(json_extract(`value`, '$.description')) LIKE '%currently configured with read-only permissions%'
      AND lower(json_extract(`value`, '$.description')) LIKE '%remaining tools are limited to read-only operations%'
  );
--> statement-breakpoint
UPDATE `task_tools`
SET
  `risk_effect` = 'read',
  `risk_idempotent` = 1
WHERE `connection_id` IN (
  SELECT `id`
  FROM `connections`
  WHERE `manifest_id` = 'neon'
    AND json_extract(`config`, '$.accessMode') = 'read_only'
);
