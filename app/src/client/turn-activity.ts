import type { RunEventDto } from "../shared.ts";

/**
 * One activity model for both surfaces. A run is a templatized chat and a
 * chat is an untemplated run, so the tool loop they each produce is
 * summarized the same way: how many calls, how many failed, how many
 * repeated a call already made, and — where the surface records timings —
 * how long each one took.
 *
 * Chat messages carry no per-step timestamps, so their steps arrive without
 * a duration and the trail draws flat. Run events carry `occurredAt`, so
 * their steps arrive weighted and the same trail draws as bars.
 */

export interface TurnStepResult {
  readonly text: string;
  readonly tone: "neutral" | "danger";
}

export interface TurnStepInput {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly result?: TurnStepResult;
  readonly running: boolean;
  readonly failed: boolean;
  /**
   * Identical signatures inside one turn are the agent repeating itself.
   * Surfaces that cannot see a call's input — run events record the
   * transport, not the arguments — omit it, and no step is called a repeat
   * on evidence that thin.
   */
  readonly signature?: string;
  readonly durationMs?: number;
}

export type TurnStep<TInput extends TurnStepInput = TurnStepInput> = TInput & {
  readonly repeat: boolean;
};

/** Generic over the step so each surface can carry its own extras. */
export interface TurnActivity<TInput extends TurnStepInput = TurnStepInput> {
  readonly steps: readonly TurnStep<TInput>[];
  readonly tools: number;
  readonly errors: number;
  readonly repeats: number;
  /** The slowest step, when the surface records timings at all. */
  readonly longestMs?: number;
}

export const EMPTY_TURN_ACTIVITY: TurnActivity = {
  steps: [],
  tools: 0,
  errors: 0,
  repeats: 0,
};

export function turnActivity<TInput extends TurnStepInput>(
  inputs: readonly TInput[],
): TurnActivity<TInput> {
  const seen = new Set<string>();
  let errors = 0;
  let repeats = 0;
  let longestMs: number | undefined;
  const steps = inputs.map((input) => {
    const repeat = input.signature !== undefined && seen.has(input.signature);
    if (input.signature !== undefined) seen.add(input.signature);
    if (repeat) repeats += 1;
    if (input.failed) errors += 1;
    if (input.durationMs !== undefined && input.durationMs >= 0) {
      longestMs = Math.max(longestMs ?? 0, input.durationMs);
    }
    return { ...input, repeat };
  });
  return {
    steps,
    tools: steps.length,
    errors,
    repeats,
    ...(longestMs !== undefined && longestMs > 0 ? { longestMs } : undefined),
  };
}

/** How tall a tick draws, 0–1, when the surface has timings. */
export function turnStepWeight(
  step: TurnStepInput,
  longestMs: number | undefined,
): number | undefined {
  if (!longestMs || step.durationMs === undefined || step.durationMs < 0) {
    return undefined;
  }
  return Math.min(1, step.durationMs / longestMs);
}

export function turnActivityTitle(activity: TurnActivity): string {
  return [
    `${activity.tools} ${activity.tools === 1 ? "tool call" : "tool calls"}`,
    activity.errors ? `${activity.errors} failed` : undefined,
    activity.repeats ? `${activity.repeats} repeated` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function toolCountLabel(tools: number): string {
  return `${tools} ${tools === 1 ? "tool" : "tools"}`;
}

export function errorCountLabel(errors: number): string {
  return `${errors} ${errors === 1 ? "error" : "errors"}`;
}

export function formatDurationMs(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * A run emits two tool events per call: the call itself (no tone) and its
 * result (tone success or error). Pairing them gives one step per call —
 * matching the run's own `toolCalls` count — plus a true duration, which is
 * why a run's trail draws as bars where chat's draws flat. Run events record
 * the transport rather than the arguments, so no signature is claimed and
 * nothing here is marked a repeat.
 *
 * Uses a FIFO queue to correctly reconcile parallel tool executions without
 * leaving concurrent calls permanently marked as running.
 */
export function runTurnActivity(
  events: readonly RunEventDto[],
  active: boolean,
): TurnActivity {
  const ordered = [...events]
    .filter((event) => event.kind === "tool")
    .sort((left, right) => left.sequence - right.sequence);
  const steps: TurnStepInput[] = [];
  const openQueue: { started: number; index: number }[] = [];
  for (const event of ordered) {
    const at = Date.parse(event.occurredAt);
    if (event.tone === undefined) {
      steps.push({
        key: event.id,
        label: event.title,
        running: true,
        failed: false,
        ...(event.detail ? { detail: event.detail } : undefined),
      });
      if (Number.isFinite(at)) {
        openQueue.push({ started: at, index: steps.length - 1 });
      }
      continue;
    }
    const open = openQueue.shift();
    const pending = open !== undefined ? steps[open.index] : undefined;
    const durationMs =
      open !== undefined && Number.isFinite(at) && at > open.started
        ? at - open.started
        : undefined;
    const closed: TurnStepInput = {
      ...(pending ?? {
        key: event.id,
        label: event.title,
        ...(event.detail ? { detail: event.detail } : undefined),
      }),
      running: false,
      failed: event.tone === "error",
      ...(durationMs === undefined ? undefined : { durationMs }),
    };
    if (pending !== undefined && open !== undefined) {
      steps[open.index] = closed;
    } else {
      steps.push(closed);
    }
  }
  if (!active) {
    for (const open of openQueue) {
      const abandoned = steps[open.index];
      if (abandoned) steps[open.index] = { ...abandoned, running: false };
    }
  }
  return turnActivity(steps);
}

