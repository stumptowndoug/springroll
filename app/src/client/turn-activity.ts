import { compactToolResultLabel } from "@springroll/kernel/tool-result-summary";
import type {
  ChatTurnDto,
  ChatUsageDto,
  RunDetailDto,
  RunEventDto,
} from "../shared.ts";
import { runToolProgressLabel } from "./chat-tool-presentation.ts";

/**
 * One activity model for both surfaces. A run is a templatized chat and a
 * chat is an untemplated run, so the tool loop they each produce is
 * summarized the same way: how many calls, how many failed, how many
 * repeated a call already made, and — where the surface records timings —
 * how long each one took.
 *
 * Both surfaces now persist per-call timings when they have them, so the
 * same trail draws as duration-weighted bars. Older chat turns without
 * `chat_tool_calls` rows still arrive untimed and draw flat.
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
    const failed = event.tone === "error";
    const resultText = event.detail?.trim();
    const result = resultText
      ? {
          text: failed ? resultText : compactToolResultLabel(resultText),
          tone: failed ? ("danger" as const) : ("neutral" as const),
        }
      : failed
        ? { text: "failed", tone: "danger" as const }
        : undefined;
    const closed: TurnStepInput = {
      ...(pending ?? {
        key: event.id,
        label: event.title,
        ...(event.detail && !result ? { detail: event.detail } : undefined),
      }),
      running: false,
      failed,
      ...(result ? { result } : undefined),
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

/**
 * One narrated line while a run is live. Prefers the in-flight tool's
 * product-language verb; otherwise Thinking / Writing like chat.
 */
export function runProgressLabel(
  events: readonly RunEventDto[],
  activity: TurnActivity,
): string {
  const running = [...activity.steps].findLast((step) => step.running);
  if (running) {
    const event = events.find((item) => item.id === running.key);
    return runToolProgressLabel({
      ...(event?.toolName ? { toolName: event.toolName } : undefined),
      label: running.label,
    });
  }
  if (events.some((event) => event.kind === "output")) {
    return "Writing";
  }
  if (activity.tools > 0) return "Writing";
  return "Thinking";
}

/** Collapsed live preview: verb plus the current tool's detail. */
export function turnLivePreview(
  label: string | undefined,
  detail?: string,
): string {
  const verb = label?.trim() || "Thinking";
  const extra = detail?.trim();
  return extra ? `${verb} · ${extra}` : verb;
}

/**
 * Token, cost, and duration for the shared turn fold. Chat turns and run
 * letters both map into this so the collapsed line and the expanded
 * breakdown are designed once.
 */
export interface TurnUsage {
  readonly durationMs?: number;
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly webSearchRequests?: number;
  readonly providerToolCalls?: number;
  readonly costUsdMicros?: number;
  readonly costEstimated?: boolean;
  readonly subscription?: boolean;
  readonly distiller?: TurnDistillerUsage;
  readonly imageGenerations?: readonly TurnImageGenerationUsage[];
}

export interface TurnDistillerUsage {
  readonly modelIds: readonly string[];
  readonly calls: number;
  readonly totalTokens: number;
  readonly costUsdMicros?: number;
  readonly costEstimated?: boolean;
}

export interface TurnImageGenerationUsage {
  readonly provider?: string;
  readonly modelId?: string;
  readonly imageCount: number;
  readonly totalTokens?: number;
  readonly costUsdMicros?: number;
  readonly costEstimated?: boolean;
  readonly subscription?: boolean;
}

export function chatTurnUsage(
  turn: ChatTurnDto | undefined,
): TurnUsage | undefined {
  if (!turn) return undefined;
  const durationMs = durationBetween(turn.startedAt, turn.finishedAt);
  const usage = chatUsageTotals(turn.usage);
  if (!durationMs && !usage) return undefined;
  return {
    ...(durationMs ? { durationMs } : undefined),
    ...usage,
  };
}

export function runTurnUsage(
  run: RunDetailDto,
  events: readonly RunEventDto[] = [],
): TurnUsage | undefined {
  const fromRun = runHasUsage(run)
    ? {
        ...(run.durationMs !== undefined
          ? { durationMs: run.durationMs }
          : undefined),
        ...(run.totalTokens !== undefined
          ? { totalTokens: run.totalTokens }
          : undefined),
        ...(run.inputTokens !== undefined
          ? { inputTokens: run.inputTokens }
          : undefined),
        ...(run.outputTokens !== undefined
          ? { outputTokens: run.outputTokens }
          : undefined),
        ...(run.reasoningTokens !== undefined
          ? { reasoningTokens: run.reasoningTokens }
          : undefined),
        ...(run.cachedInputTokens !== undefined
          ? { cachedInputTokens: run.cachedInputTokens }
          : undefined),
        ...(run.webSearchRequests !== undefined
          ? { webSearchRequests: run.webSearchRequests }
          : undefined),
        ...runCost(run),
        ...(run.distiller
          ? { distiller: runDistillerUsage(run.distiller) }
          : undefined),
      }
    : undefined;
  const fromEvents = aggregateEventUsage(events);
  const usage = mergeTurnUsage(fromRun, fromEvents);
  if (!usage) return undefined;
  return {
    ...usage,
    ...(run.durationMs !== undefined && usage.durationMs === undefined
      ? { durationMs: run.durationMs }
      : undefined),
    ...(run.distiller && !usage.distiller
      ? { distiller: runDistillerUsage(run.distiller) }
      : undefined),
  };
}

export function hasTurnUsage(usage: TurnUsage | undefined): boolean {
  if (!usage) return false;
  return (
    usage.durationMs !== undefined ||
    usage.totalTokens !== undefined ||
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.reasoningTokens !== undefined ||
    usage.cachedInputTokens !== undefined ||
    usage.webSearchRequests !== undefined ||
    usage.providerToolCalls !== undefined ||
    usage.costUsdMicros !== undefined ||
    usage.subscription === true ||
    usage.distiller !== undefined ||
    Boolean(usage.imageGenerations?.length)
  );
}

/** Collapsed line: duration, total tokens, cost. */
export function turnUsageSummary(
  usage: TurnUsage | undefined,
  liveElapsed?: string,
): readonly string[] {
  if (!usage && !liveElapsed) return [];
  const facts: string[] = [];
  if (liveElapsed) facts.push(liveElapsed);
  else if (usage?.durationMs !== undefined) {
    facts.push(formatDurationMs(usage.durationMs));
  }
  if (usage?.totalTokens) {
    facts.push(`${usage.totalTokens.toLocaleString()} tokens`);
  }
  if (usage?.subscription) facts.push("subscription");
  else if (usage?.costUsdMicros !== undefined) {
    facts.push(
      `${usage.costEstimated ? "~" : ""}${formatUsdMicros(usage.costUsdMicros)}`,
    );
  }
  return facts;
}

/** Expanded breakdown: input/output/cached and the rest of the meter. */
export function turnUsageDetails(
  usage: TurnUsage | undefined,
): readonly string[] {
  if (!usage) return [];
  return [
    usage.inputTokens
      ? `${usage.inputTokens.toLocaleString()} input`
      : undefined,
    usage.outputTokens
      ? `${usage.outputTokens.toLocaleString()} output`
      : undefined,
    usage.cachedInputTokens
      ? `${usage.cachedInputTokens.toLocaleString()} cached`
      : undefined,
    usage.reasoningTokens
      ? `${usage.reasoningTokens.toLocaleString()} reasoning`
      : undefined,
    usage.webSearchRequests
      ? `${usage.webSearchRequests} web ${
          usage.webSearchRequests === 1 ? "search" : "searches"
        }`
      : undefined,
    usage.providerToolCalls
      ? `${usage.providerToolCalls} provider ${
          usage.providerToolCalls === 1 ? "call" : "calls"
        }`
      : undefined,
    usage.subscription
      ? "subscription"
      : usage.costUsdMicros !== undefined
        ? `${usage.costEstimated ? "~" : ""}${formatUsdMicros(usage.costUsdMicros)}`
        : undefined,
  ].filter((item): item is string => Boolean(item));
}

export function turnUsageDistillerDetails(
  usage: TurnUsage | undefined,
): readonly string[] {
  const distiller = usage?.distiller;
  if (!distiller) return [];
  return [
    "research distiller",
    distiller.modelIds.join(", ") || undefined,
    `${distiller.totalTokens.toLocaleString()} tokens`,
    distiller.costUsdMicros === undefined
      ? undefined
      : `${distiller.costEstimated ? "~" : ""}${formatUsdMicros(distiller.costUsdMicros)}`,
    `${distiller.calls} ${distiller.calls === 1 ? "call" : "calls"}`,
  ].filter((item): item is string => Boolean(item));
}

export function turnUsageImageDetails(
  usage: TurnUsage | undefined,
): readonly string[] {
  return (usage?.imageGenerations ?? []).map((image) =>
    [
      "image generation",
      [image.provider, image.modelId].filter(Boolean).join(" · ") || undefined,
      `${image.imageCount} ${image.imageCount === 1 ? "image" : "images"}`,
      image.totalTokens
        ? `${image.totalTokens.toLocaleString()} tokens`
        : undefined,
      image.subscription
        ? "subscription"
        : image.costUsdMicros !== undefined
          ? `${image.costEstimated ? "~" : ""}${formatUsdMicros(image.costUsdMicros)}`
          : "cost unavailable",
    ]
      .filter((item): item is string => Boolean(item))
      .join(" · "),
  );
}

export function formatUsdMicros(value: number): string {
  const dollars = value / 1_000_000;
  return `$${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}

function chatUsageTotals(usage: ChatUsageDto): TurnUsage | undefined {
  const costUsdMicros =
    usage.actualCostUsdMicros || usage.estimatedCostUsdMicros || undefined;
  const totals: TurnUsage = {
    ...(usage.totalTokens ? { totalTokens: usage.totalTokens } : undefined),
    ...(usage.inputTokens ? { inputTokens: usage.inputTokens } : undefined),
    ...(usage.outputTokens ? { outputTokens: usage.outputTokens } : undefined),
    ...(usage.reasoningTokens
      ? { reasoningTokens: usage.reasoningTokens }
      : undefined),
    ...(usage.cachedInputTokens
      ? { cachedInputTokens: usage.cachedInputTokens }
      : undefined),
    ...(usage.webSearchRequests
      ? { webSearchRequests: usage.webSearchRequests }
      : undefined),
    ...(usage.providerToolCalls
      ? { providerToolCalls: usage.providerToolCalls }
      : undefined),
    ...(costUsdMicros ? { costUsdMicros } : undefined),
    ...(!usage.actualCostUsdMicros && usage.estimatedCostUsdMicros
      ? { costEstimated: true }
      : undefined),
  };
  return hasTurnUsage(totals) ? totals : undefined;
}

function runHasUsage(run: RunDetailDto): boolean {
  return (
    run.durationMs !== undefined ||
    run.totalTokens !== undefined ||
    run.inputTokens !== undefined ||
    run.outputTokens !== undefined ||
    run.reasoningTokens !== undefined ||
    run.cachedInputTokens !== undefined ||
    run.webSearchRequests !== undefined ||
    run.actualCostUsdMicros !== undefined ||
    run.estimatedCostUsdMicros !== undefined ||
    run.costUsdMicros !== undefined ||
    run.modelBilling === "subscription" ||
    run.distiller !== undefined
  );
}

function runCost(
  run: RunDetailDto,
): Pick<TurnUsage, "costUsdMicros" | "costEstimated" | "subscription"> {
  if (run.modelBilling === "subscription") return { subscription: true };
  const costUsdMicros =
    run.costUsdMicros ?? run.actualCostUsdMicros ?? run.estimatedCostUsdMicros;
  if (costUsdMicros === undefined) return {};
  const costEstimated =
    run.actualCostUsdMicros === undefined &&
    run.costSource !== "provider_reported";
  return {
    costUsdMicros,
    ...(costEstimated ? { costEstimated: true } : undefined),
  };
}

function runDistillerUsage(
  distiller: NonNullable<RunDetailDto["distiller"]>,
): TurnDistillerUsage {
  return {
    modelIds: distiller.modelIds,
    calls: distiller.calls,
    totalTokens: distiller.totalTokens,
    ...(distiller.costUsdMicros !== undefined
      ? { costUsdMicros: distiller.costUsdMicros }
      : undefined),
    ...(distiller.costSource !== undefined &&
    distiller.costSource !== "provider_reported"
      ? { costEstimated: true }
      : undefined),
  };
}

function aggregateEventUsage(
  events: readonly RunEventDto[],
): TurnUsage | undefined {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cachedInputTokens = 0;
  let webSearchRequests = 0;
  let providerToolCalls = 0;
  let costUsdMicros = 0;
  let costEstimated = false;
  let subscription = false;
  const imageGenerations: TurnImageGenerationUsage[] = [];
  let seen = false;
  for (const event of events) {
    if (event.kind !== "usage" || !event.usage) continue;
    seen = true;
    totalTokens += event.usage.totalTokens ?? 0;
    inputTokens += event.usage.inputTokens ?? 0;
    outputTokens += event.usage.outputTokens ?? 0;
    reasoningTokens += event.usage.reasoningTokens ?? 0;
    cachedInputTokens += event.usage.cachedInputTokens ?? 0;
    webSearchRequests += event.usage.webSearchRequests ?? 0;
    providerToolCalls += event.usage.providerToolCalls ?? 0;
    costUsdMicros += event.usage.costUsdMicros ?? 0;
    if (event.usage.costEstimated) costEstimated = true;
    if (event.usage.subscription) subscription = true;
    if (event.usage.operation === "image_generation") {
      imageGenerations.push({
        ...(event.usage.provider
          ? { provider: event.usage.provider }
          : undefined),
        ...(event.usage.modelId ? { modelId: event.usage.modelId } : undefined),
        imageCount: event.usage.imageCount ?? 1,
        ...(event.usage.totalTokens !== undefined
          ? { totalTokens: event.usage.totalTokens }
          : undefined),
        ...(event.usage.costUsdMicros !== undefined
          ? { costUsdMicros: event.usage.costUsdMicros }
          : undefined),
        ...(event.usage.costEstimated ? { costEstimated: true } : undefined),
        ...(event.usage.subscription ? { subscription: true } : undefined),
      });
    }
  }
  if (!seen) return undefined;
  return {
    ...(totalTokens ? { totalTokens } : undefined),
    ...(inputTokens ? { inputTokens } : undefined),
    ...(outputTokens ? { outputTokens } : undefined),
    ...(reasoningTokens ? { reasoningTokens } : undefined),
    ...(cachedInputTokens ? { cachedInputTokens } : undefined),
    ...(webSearchRequests ? { webSearchRequests } : undefined),
    ...(providerToolCalls ? { providerToolCalls } : undefined),
    ...(costUsdMicros ? { costUsdMicros } : undefined),
    ...(costEstimated ? { costEstimated: true } : undefined),
    ...(subscription ? { subscription: true } : undefined),
    ...(imageGenerations.length ? { imageGenerations } : undefined),
  };
}

function mergeTurnUsage(
  primary: TurnUsage | undefined,
  fallback: TurnUsage | undefined,
): TurnUsage | undefined {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return { ...fallback, ...primary };
}

function durationBetween(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const started = new Date(startedAt).getTime();
  const finished = new Date(finishedAt).getTime();
  return Number.isFinite(started) &&
    Number.isFinite(finished) &&
    finished > started
    ? finished - started
    : undefined;
}
