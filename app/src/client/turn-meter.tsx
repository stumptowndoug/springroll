import {
  errorCountLabel,
  type TurnActivity,
  toolCountLabel,
  turnActivityTitle,
  turnStepWeight,
} from "./turn-activity.ts";

/**
 * The turn meter: one tick per tool call, colored by outcome and — when the
 * surface records timings — sized by duration. Shared by chat turns and run
 * letters so both read the same at a glance.
 */
export function ActivityTrail({
  activity,
}: {
  readonly activity: TurnActivity;
}) {
  if (activity.tools === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="activity-trail"
      title={turnActivityTitle(activity)}
    >
      {activity.steps.map((step) => {
        const weight = turnStepWeight(step, activity.longestMs);
        return (
          <i
            className={`activity-tick${
              step.running
                ? " running"
                : step.failed
                  ? " failed"
                  : step.repeat
                    ? " repeat"
                    : ""
            }`}
            key={step.key}
            {...(weight === undefined
              ? undefined
              : { style: { height: `${5 + Math.round(weight * 9)}px` } })}
          />
        );
      })}
    </span>
  );
}

/**
 * Mono telemetry beside the trail: tool count, failures in danger, then
 * whatever the surface can honestly report yet (elapsed, tokens, cost).
 */
export function TurnFacts({
  activity,
  trailing,
}: {
  readonly activity: TurnActivity;
  readonly trailing: readonly string[];
}) {
  const leading = activity.tools ? [toolCountLabel(activity.tools)] : [];
  if (leading.length === 0 && trailing.length === 0 && !activity.errors) {
    return null;
  }
  return (
    <span className="turn-facts">
      {leading.join(" · ")}
      {activity.errors ? (
        <>
          {leading.length ? " · " : null}
          <span className="turn-facts-error">
            {errorCountLabel(activity.errors)}
          </span>
        </>
      ) : null}
      {trailing.length ? ` · ${trailing.join(" · ")}` : null}
    </span>
  );
}

export function StopTurnButton({ onStop }: { readonly onStop: () => void }) {
  return (
    <button className="stop-turn" onClick={onStop} type="button">
      <i aria-hidden="true" />
      Stop
    </button>
  );
}
