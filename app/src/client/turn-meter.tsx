import { type ReactNode, useEffect, useState } from "react";
import {
  EMPTY_TURN_ACTIVITY,
  errorCountLabel,
  formatDurationMs,
  hasTurnUsage,
  type TurnActivity,
  type TurnStepInput,
  type TurnUsage,
  toolCountLabel,
  turnActivityTitle,
  turnLivePreview,
  turnStepWeight,
  turnUsageDetails,
  turnUsageDistillerDetails,
  turnUsageImageDetails,
  turnUsageSummary,
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
    <button
      aria-label="Stop current work"
      className="stop-turn"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStop();
      }}
      title="Stop current work"
      type="button"
    >
      <i aria-hidden="true" />
      Stop
    </button>
  );
}

function ShowWorkButton({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={open}
      className="show-work"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      type="button"
    >
      {open ? "Hide work" : "Show work"}
    </button>
  );
}

interface TurnWorkIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * One fold for both surfaces, live and finished. Collapsed by default: a
 * single line with the status (or "Show work"), the trail, and a token
 * usage summary. Expanding reveals the tool list and the usage breakdown.
 */
export function TurnWork<TInput extends TurnStepInput>({
  activity,
  live = false,
  label,
  model,
  onStop,
  startedAt,
  usage,
  actions,
}: {
  readonly activity: TurnActivity<TInput>;
  readonly live?: boolean;
  readonly label?: string;
  readonly model?: string;
  readonly onStop?: () => void;
  readonly startedAt?: string;
  readonly usage?: TurnUsage;
  readonly actions?: ReactNode | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!live || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live, startedAt]);
  if (!live && activity.tools === 0 && !hasTurnUsage(usage) && !model) {
    return actions ? (
      <div className="chat-message-footer">{actions}</div>
    ) : null;
  }

  const started = startedAt ? new Date(startedAt).getTime() : undefined;
  const elapsed =
    live && started !== undefined && Number.isFinite(started) && now > started
      ? formatDurationMs(now - started)
      : undefined;
  const trailing = turnUsageSummary(usage, elapsed);
  const details = turnUsageDetails(usage);
  const distiller = turnUsageDistillerDetails(usage);
  const imageDetails = turnUsageImageDetails(usage);
  const running = live
    ? [...activity.steps].findLast((step) => step.running)
    : undefined;
  const preview = live ? turnLivePreview(label, running?.detail) : undefined;
  const expandable =
    activity.tools > 0 ||
    details.length > 0 ||
    distiller.length > 0 ||
    imageDetails.length > 0 ||
    Boolean(model);

  return (
    <details
      className={`chat-work${live ? " live" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="turn-meter">
        {live ? <span className="chat-status-dot" aria-hidden="true" /> : null}
        {preview ? (
          <span className="chat-work-toggle" title={preview}>
            {preview}
          </span>
        ) : null}
        <ActivityTrail activity={activity} />
        <TurnFacts activity={activity} trailing={trailing} />
        {expandable ? (
          <ShowWorkButton
            open={open}
            onToggle={() => setOpen((current) => !current)}
          />
        ) : null}
        {onStop ? <StopTurnButton onStop={onStop} /> : null}
        {actions}
      </summary>
      {activity.tools > 0 ? (
        <ol className="chat-work-steps">
          {activity.steps.map((step) => (
            <li key={step.key}>
              <span
                className={`chat-step-dot${step.running ? " running" : step.failed ? " failed" : step.repeat ? " repeat" : ""}`}
                aria-hidden="true"
              />
              <span className="chat-step-what">
                {step.label}
                {step.repeat ? (
                  <span className="chat-step-repeat">repeat</span>
                ) : null}
                {step.detail ? <StepDetail text={step.detail} /> : null}
                {stepIssues(step)?.map((issue) => (
                  <small
                    className="failed"
                    key={`${issue.path}:${issue.message}`}
                  >
                    {issue.path}: {issue.message}
                  </small>
                ))}
              </span>
              {step.result ? (
                <span
                  className={`chat-step-result${step.result.tone === "danger" ? " failed" : ""}`}
                >
                  {step.result.text}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {details.length > 0 ||
      distiller.length > 0 ||
      imageDetails.length > 0 ||
      model ? (
        <div className="chat-work-usage">
          {details.length > 0 ? <div>{details.join(" · ")}</div> : null}
          {imageDetails.map((detail) => (
            <div key={detail}>{detail}</div>
          ))}
          {distiller.length > 0 ? <div>{distiller.join(" · ")}</div> : null}
          {model ? <div>{model}</div> : null}
        </div>
      ) : null}
    </details>
  );
}

/** Short details stay a preview; longer ones open to the full text. */
function StepDetail({ text }: { readonly text: string }) {
  if (text.length <= 280) {
    return <small>{text}</small>;
  }
  return (
    <details
      className="chat-step-detail"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary>{text}</summary>
    </details>
  );
}

function stepIssues(step: TurnStepInput): readonly TurnWorkIssue[] | undefined {
  if (!("issues" in step) || !Array.isArray(step.issues)) return undefined;
  return step.issues.filter(
    (issue): issue is TurnWorkIssue =>
      issue !== null &&
      typeof issue === "object" &&
      typeof issue.path === "string" &&
      typeof issue.message === "string",
  );
}

export function TurnStatusLine({
  activity = EMPTY_TURN_ACTIVITY,
  label,
  onStop,
  startedAt,
}: {
  readonly activity?: TurnActivity;
  readonly label: string;
  readonly onStop?: () => void;
  readonly startedAt?: string;
}) {
  return (
    <TurnWork
      activity={activity}
      live
      label={label}
      {...(onStop ? { onStop } : undefined)}
      {...(startedAt ? { startedAt } : undefined)}
    />
  );
}
