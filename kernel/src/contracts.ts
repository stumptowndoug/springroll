import type { JsonObject, PinnedTool } from "./tools.ts";

export type CatchUpPolicy = "catch_up" | "skip_to_next";
export type ExecutionLocation = "local" | "hosted";

export interface Task {
  readonly id: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly nextRunAt: Date;
  readonly catchUpPolicy: CatchUpPolicy;
  readonly tools: readonly PinnedTool[];
}

export interface Connection {
  readonly id: string;
  readonly sourceId: string;
  readonly credentialRef: string;
  readonly availableIn: readonly ExecutionLocation[];
}

export interface RunTranscript {
  readonly summary: string;
  readonly body: string;
}

export interface RunToolCallSummary {
  readonly toolName: string;
  readonly input: JsonObject;
  readonly status: "succeeded" | "failed";
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outputSummary?: string;
  readonly error?: string;
}

export interface RunModelUsage {
  readonly provider?: string;
  readonly modelId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsdMicros?: number;
}

export interface RunTaskResult {
  readonly transcript: RunTranscript;
  readonly toolCalls: readonly RunToolCallSummary[];
  readonly usage: RunModelUsage;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}
