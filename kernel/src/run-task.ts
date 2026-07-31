import type { AgentEventSink } from "./agent-events.ts";
import type {
  Connection,
  ExecutionLocation,
  RunTaskResult,
  Task,
} from "./contracts.ts";
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
  readonly tools: readonly ExecutableTool[];
  readonly eventSink?: AgentEventSink;
  readonly signal?: AbortSignal;
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
  readonly connections: readonly Connection[];
  readonly location: ExecutionLocation;
  readonly eventSink?: AgentEventSink;
  readonly signal?: AbortSignal;
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
      tools,
      ...(request.eventSink ? { eventSink: request.eventSink } : undefined),
      ...(request.signal ? { signal: request.signal } : undefined),
    });
  } finally {
    await Promise.allSettled(
      Array.from(sessions.values(), (session) => session.close()),
    );
  }
}
