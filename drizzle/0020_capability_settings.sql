-- The old approval value was derived from risk, not chosen by the user.
-- Reset every existing pin to the new default Allow setting; destructive
-- risk still forces approval at execution time in the host.
UPDATE `task_tools` SET `approval` = 'never';
--> statement-breakpoint
-- Direct task and connection actions no longer create proposal workflows.
-- Connection setup remains host-owned because OAuth and credential entry
-- genuinely require a person.
DELETE FROM `assistant_workflows` WHERE `kind` <> 'connection_setup';
