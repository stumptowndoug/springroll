import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { AgentEventSink } from "./agent-events.ts";
import type {
  Connection,
  ExecutionLocation,
  RunTaskResult,
  Task,
} from "./contracts.ts";
import type {
  RecipeKnowledgeDocument,
  RecipeKnowledgeStatus,
} from "./recipe-knowledge.ts";
import {
  type ExecutableTool,
  resolvePinnedTools,
  ToolPolicyError,
  type ToolSource,
  type ToolSourceSession,
} from "./tools.ts";

export interface AgentRunRequest {
  readonly runId: string;
  readonly task: Task;
  readonly scheduledTime?: Date;
  readonly tools: readonly ExecutableTool[];
  readonly recipeContext?: AgentRecipeContext;
  readonly eventSink?: AgentEventSink;
  readonly signal?: AbortSignal;
  readonly continuation?: {
    readonly messages: readonly ModelMessage[];
    readonly startedAt: Date;
    readonly cumulativeInputTokens?: number;
    readonly approvals: readonly {
      readonly id: string;
      readonly approved: boolean;
      readonly reason?: string;
    }[];
  };
  readonly approvalExecution?: {
    starting(toolCallId: string): Promise<void> | void;
    finished(
      toolCallId: string,
      status: "succeeded" | "failed",
    ): Promise<void> | void;
  };
}

export interface AgentRecipeContext {
  readonly recipeKnowledge?: {
    readonly revision: number;
    readonly status: RecipeKnowledgeStatus;
    readonly knowledge: RecipeKnowledgeDocument;
  };
  readonly recentRuns: readonly AgentRecipeHistoryItem[];
}

export interface AgentRecipeHistoryItem {
  readonly runId: string;
  readonly scheduledTime: Date;
  readonly status:
    | "claimed"
    | "running"
    | "waiting_for_approval"
    | "succeeded"
    | "failed";
  readonly summary?: string;
  readonly error?: string;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<RunTaskResult>;
}

export interface RunTaskDependencies {
  readonly agent: AgentRunner;
  readonly getToolSource: (sourceId: string) => ToolSource | undefined;
}

export interface RunTaskRequest {
  readonly runId?: string;
  readonly task: Task;
  readonly scheduledTime?: Date;
  readonly connections: readonly Connection[];
  readonly location: ExecutionLocation;
  readonly eventSink?: AgentEventSink;
  readonly signal?: AbortSignal;
  readonly additionalTools?: readonly ExecutableTool[];
  readonly recipeContext?: AgentRecipeContext;
  readonly continuation?: AgentRunRequest["continuation"];
  readonly approvalExecution?: AgentRunRequest["approvalExecution"];
}

export async function runTask(
  request: RunTaskRequest,
  dependencies: RunTaskDependencies,
): Promise<RunTaskResult> {
  const connectionsById = new Map(
    request.connections.map((connection) => [connection.id, connection]),
  );
  const sessions = new Map<string, ToolSourceSession>();

  try {
    const tools: ExecutableTool[] = [];

    for (const pin of request.task.tools) {
      const connection = connectionsById.get(pin.connectionId);
      if (!connection || connection.sourceId !== pin.sourceId) {
        throw new ToolPolicyError(
          `Missing connection for ${pin.sourceId}/${pin.name}`,
        );
      }

      if (!connection.availableIn.includes(request.location)) {
        throw new ToolPolicyError(
          `${pin.sourceId}/${pin.name} cannot run in ${request.location}`,
        );
      }

      let session = sessions.get(connection.id);
      if (!session) {
        const source = dependencies.getToolSource(pin.sourceId);
        if (!source) {
          throw new ToolPolicyError(`Unknown tool source: ${pin.sourceId}`);
        }

        session = await source.open({
          connection,
          location: request.location,
        });
        sessions.set(connection.id, session);
      }

      tools.push(...(await resolvePinnedTools(session, [pin])));
    }

    return await dependencies.agent.run({
      runId: request.runId ?? crypto.randomUUID(),
      task: request.task,
      ...(request.scheduledTime
        ? { scheduledTime: request.scheduledTime }
        : undefined),
      tools: [...tools, ...(request.additionalTools ?? [])],
      ...(request.recipeContext
        ? { recipeContext: request.recipeContext }
        : undefined),
      ...(request.eventSink ? { eventSink: request.eventSink } : undefined),
      ...(request.signal ? { signal: request.signal } : undefined),
      ...(request.continuation
        ? { continuation: request.continuation }
        : undefined),
      ...(request.approvalExecution
        ? { approvalExecution: request.approvalExecution }
        : undefined),
    });
  } finally {
    await Promise.allSettled(
      Array.from(sessions.values(), (session) => session.close()),
    );
  }
}

export interface AgentRunTemporalContext {
  readonly effectiveDate: string;
  readonly instructions: string;
}

export function agentRunTemporalContext(
  request: AgentRunRequest,
  startedAt: Date,
): AgentRunTemporalContext {
  const scheduledTime = request.scheduledTime ?? startedAt;
  const timezone = request.task.scheduleTimezone ?? "UTC";
  const effectiveDate = dateInTimezone(scheduledTime, timezone);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(scheduledTime);
  return {
    effectiveDate,
    instructions: [
      "The host clock is authoritative; never infer the date from model knowledge or search ranking.",
      `Scheduled occurrence: ${scheduledTime.toISOString()}.`,
      `Task timezone: ${timezone}. Scheduled local time: ${localTime}.`,
      `Actual run start: ${startedAt.toISOString()}.`,
      `Interpret relative dates using ${effectiveDate}. For time-sensitive web work, include this exact date in the search query.`,
    ].join(" "),
  };
}

function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) {
    throw new RangeError(`Could not resolve scheduled date in ${timezone}`);
  }
  return `${year}-${month}-${day}`;
}
