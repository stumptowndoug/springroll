# Local missed-run policy

Springroll schedules recipes only while its local runtime is available. Sleep,
app downtime, and scheduler downtime can all delay delivery. This policy does
not wake a Mac or promise execution while it sleeps.

## Behavior

The recipe's existing policy controls late scheduled occurrences:

| Policy | Delivery more than 60 seconds late | Next scheduled time |
| --- | --- | --- |
| Skip to the next time (`skip_to_next`, existing default) | Do not create or execute a run | First cron occurrence strictly after recovery |
| Run once when available (`catch_up`) | Claim one run for the earliest outstanding occurrence; do not replay the backlog | First cron occurrence strictly after recovery |

Delivery up to and including 60 seconds late runs normally under either policy.
This fixed grace period tolerates ordinary alarm delivery/startup delays. It is
not an inference that the computer was asleep. Early callbacks do not claim work.

A claimed, running, or approval-waiting run prevents another scheduled run from
being admitted. The cursor advances past recovery time rather than building an
overlap queue. Disabled recipes do not admit work. Stale callback timestamps do
not modify the cursor. Claim and cursor advancement are one SQLite transaction,
and occurrence uniqueness guards repeated delivery.

The recipe detail retains the latest schedule-recovery outcome and recovery
time: catch-up queued, missed work skipped, or overlap skipped. This is a latest
receipt, not a complete scheduling audit or a count of all missed occurrences.
Ordinary subsequent runs do not erase it. A queued catch-up is not a claim that
execution succeeded; the run itself records its result.

Changing the policy does not change completed runs. Neither option replays every
missed occurrence. Failed external requests are run failures, not missed alarms;
this policy does not automatically retry failed runs or guarantee exactly-once
side effects in external systems.

## Verification

Automated tests cover delivery/grace boundaries, stale callbacks, disabled
recipes, active and approval-waiting overlaps, multi-day downtime, spring/fall
DST transitions, SQLite reopen, and real Rivet engine/registry restart. The engine
test uses an isolated database and stub executor, without provider charges or
external side effects.

## Remaining Mac acceptance checks

Do these deliberately on a test account/device; automated tests do not put the
developer's Mac to sleep or change its clock/power settings.

- Schedule harmless recipes using each policy, sleep through their due time by
  more than a minute, then wake. Verify zero skipped-policy executions, one
  catch-up execution, recovery text, and future next-run timestamps.
- Repeat overnight/weekend sleep and app quit/relaunch with multiple missed
  occurrences. Relaunch again and verify no duplicate catch-up.
- Wake without networking, then restore it. Verify scheduler/provider recovery,
  actionable failure reporting, and no duplicate external actions. Do not assume
  that network restoration retries a failed run.
- Repeat with a paused recipe and an approval-waiting run; verify no unintended
  execution. Check the displayed timezone and next run after timezone changes.
- Repeat lifecycle tests once the packaged shell owns both sidecars. That final
  packaged-app acceptance belongs to priority 3.
