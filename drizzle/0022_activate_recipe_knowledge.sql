-- Recipe memory is passive context, not an authority grant. Activate the newest
-- safe pending revision for each recipe without a human-review checkpoint.
UPDATE `task_execution_profiles` AS `current`
SET
  `status` = 'superseded',
  `updated_at` = unixepoch() * 1000
WHERE `current`.`status` = 'ready'
  AND EXISTS (
    SELECT 1
    FROM `task_execution_profiles` AS `candidate`
    WHERE `candidate`.`task_id` = `current`.`task_id`
      AND `candidate`.`status` = 'needs_review'
      AND `candidate`.`revision` > `current`.`revision`
  );
--> statement-breakpoint
UPDATE `task_execution_profiles` AS `current`
SET
  `status` = 'superseded',
  `updated_at` = unixepoch() * 1000
WHERE `current`.`status` = 'needs_review'
  AND EXISTS (
    SELECT 1
    FROM `task_execution_profiles` AS `candidate`
    WHERE `candidate`.`task_id` = `current`.`task_id`
      AND `candidate`.`status` = 'needs_review'
      AND `candidate`.`revision` > `current`.`revision`
  );
--> statement-breakpoint
UPDATE `task_execution_profiles`
SET
  `status` = 'ready',
  `approved_at` = COALESCE(`approved_at`, unixepoch() * 1000),
  `validated_at` = COALESCE(`validated_at`, unixepoch() * 1000),
  `updated_at` = unixepoch() * 1000
WHERE `status` = 'needs_review';
