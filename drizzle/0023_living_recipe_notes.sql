-- Recipe notes are a living document: the latest revision is active and
-- earlier revisions are superseded history. Retire the review/staleness
-- statuses — delete abandoned mid-run drafts, keep at most one active
-- revision per recipe, and fold everything else into history.
DELETE FROM `task_execution_profiles` WHERE `status` = 'learning';
--> statement-breakpoint
UPDATE `task_execution_profiles` AS `current`
SET
  `status` = 'superseded',
  `updated_at` = unixepoch() * 1000
WHERE `current`.`status` IN ('needs_review', 'stale', 'ready')
  AND EXISTS (
    SELECT 1
    FROM `task_execution_profiles` AS `candidate`
    WHERE `candidate`.`task_id` = `current`.`task_id`
      AND `candidate`.`status` != 'superseded'
      AND `candidate`.`revision` > `current`.`revision`
  );
--> statement-breakpoint
UPDATE `task_execution_profiles`
SET
  `status` = 'ready',
  `updated_at` = unixepoch() * 1000
WHERE `status` IN ('needs_review', 'stale');
--> statement-breakpoint
ALTER TABLE `task_execution_profiles` DROP COLUMN `stale_reason`;--> statement-breakpoint
ALTER TABLE `task_execution_profiles` DROP COLUMN `approved_at`;--> statement-breakpoint
ALTER TABLE `task_execution_profiles` DROP COLUMN `validated_at`;
