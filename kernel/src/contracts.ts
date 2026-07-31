import type { JsonObject, PinnedTool } from "./tools.ts";

export type CatchUpPolicy = "catch_up" | "skip_to_next";
export type ExecutionLocation = "local" | "hosted";

export interface TaskModelSelection {
  readonly providerId: string;
  readonly modelId: string;
}

export interface Task {
  readonly id: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly nextRunAt: Date;
  readonly catchUpPolicy: CatchUpPolicy;
  readonly tools: readonly PinnedTool[];
  readonly modelSelection?: TaskModelSelection;
}

export interface Connection {
  readonly id: string;
  readonly sourceId: string;
  readonly credentialRef: string;
  readonly availableIn: readonly ExecutionLocation[];
  readonly config?: JsonObject;
}

export type RunDisposition =
  | "informational"
  | "no_change"
  | "needs_attention"
  | "needs_approval";

export type RunResultBody = JsonObject & {
  readonly format: "markdown";
  readonly content: string;
};

export type RunResultSource = JsonObject & {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly retrievedAt?: string;
};

export type RunResultNotice = JsonObject & {
  readonly level: "info" | "warning";
  readonly message: string;
};

export type RunResultProposal = JsonObject & {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly payload?: JsonObject;
};

export type RunResultArtifact = JsonObject & {
  readonly id: string;
  readonly kind: "table" | "chart" | "file";
  readonly title: string;
  readonly mediaType?: string;
  readonly payload?: JsonObject;
};

export type RunResultV1 = JsonObject & {
  readonly schemaVersion: 1;
  readonly disposition: RunDisposition;
  readonly summary: string;
  readonly body: RunResultBody;
  readonly sources: readonly RunResultSource[];
  readonly artifacts: readonly RunResultArtifact[];
  readonly proposals: readonly RunResultProposal[];
  readonly notices: readonly RunResultNotice[];
};

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
  readonly result: RunResultV1;
  readonly toolCalls: readonly RunToolCallSummary[];
  readonly usage: RunModelUsage;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}
