import type { RunResultV1 } from "@springroll/kernel";

export type RunStatus = "claimed" | "running" | "succeeded" | "failed";
export type CatchUpPolicy = "catch_up" | "skip_to_next";
export type ModelProviderId = "openrouter" | "openai" | "xai";

export interface ModelSelectionDto {
  readonly providerId: ModelProviderId;
  readonly modelId: string;
}

export interface ModelToolRouteDto {
  readonly capability: "web.fetch" | "web.search";
  readonly profile: "managed-auto" | "native" | "portable";
  readonly service: "exa" | ModelProviderId;
}

export interface ModelExecutionDto extends ModelSelectionDto {
  readonly selectedBy: "automatic" | "default" | "task";
  readonly toolRoutes: readonly ModelToolRouteDto[];
}

export interface ModelOptionDto extends ModelSelectionDto {
  readonly name: string;
  readonly description?: string;
  readonly contextTokens?: number;
  readonly inputUsdPerMillionTokens?: number;
  readonly outputUsdPerMillionTokens?: number;
  readonly reasoning: boolean;
  readonly toolCall: boolean;
  readonly inputModalities: readonly string[];
}

export interface ModelProviderDto {
  readonly id: ModelProviderId;
  readonly name: string;
  readonly kind: "aggregator" | "direct_api";
  readonly status: "connected" | "not_connected";
  readonly keyCreationUrl: string;
  readonly keyPlaceholder: string;
  readonly logoSvg?: string;
}

export interface ModelSettingsDto {
  readonly providers: readonly ModelProviderDto[];
  readonly models: readonly ModelOptionDto[];
  readonly defaultSelection?: ModelSelectionDto;
  readonly catalogUpdatedAt?: string;
  readonly catalogStale: boolean;
}

export interface RunSummaryDto {
  readonly id: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly status: RunStatus;
  readonly scheduledTime: string;
  readonly summary?: string;
  readonly error?: string;
  readonly needsAttention: boolean;
}

export interface RunDetailDto extends RunSummaryDto {
  readonly body?: string;
  readonly result?: RunResultV1;
  readonly executionLocation: "local" | "hosted";
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly modelProvider?: string;
  readonly modelId?: string;
  readonly modelBilling?: "metered" | "subscription" | "unknown";
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsdMicros?: number;
  readonly actualCostUsdMicros?: number;
  readonly estimatedCostUsdMicros?: number;
  readonly costSource?: "provider_reported" | "catalog_estimate";
  readonly webSearchRequests?: number;
  readonly catalogRevision?: string;
  readonly toolCalls: number;
}

export interface RunStartDto {
  readonly id: string;
}

export type RunEventKind =
  | "status"
  | "model"
  | "tool"
  | "source"
  | "usage"
  | "policy"
  | "output";

export interface RunEventDto {
  readonly id: string;
  readonly sequence: number;
  readonly kind: RunEventKind;
  readonly title: string;
  readonly occurredAt: string;
  readonly detail?: string;
  readonly tone?: "neutral" | "success" | "error";
  readonly sourceUrl?: string;
}

export interface RunEventPageDto {
  readonly runId: string;
  readonly runStatus: RunStatus;
  readonly events: readonly RunEventDto[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
}

export interface TaskSummaryDto {
  readonly id: string;
  readonly name: string;
  /** Optional single organizing tag, e.g. "news". */
  readonly tag?: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly catchUpPolicy: CatchUpPolicy;
  readonly nextRunAt: string;
  readonly connectionNames: readonly string[];
  /** Statuses of the most recent runs, oldest first, at most seven. */
  readonly recentRunStatuses: readonly RunStatus[];
  readonly modelOverride?: ModelSelectionDto;
}

export interface ProposalToolDto {
  readonly name: string;
  readonly description: string;
  readonly effect: "read" | "write" | "destructive";
}

export interface TaskProposalDto {
  readonly title: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly scheduleLabel: string;
  readonly timezone: string;
  readonly connectionId: string;
  readonly connectionName: string;
  readonly toolNames: readonly string[];
  readonly tools: readonly ProposalToolDto[];
  readonly contract: string;
  readonly executionMode: "local";
  readonly catchUpPolicy: CatchUpPolicy;
  readonly modelExecution?: ModelExecutionDto;
}

export type TaskProposalOutcomeDto =
  | {
      readonly status: "ready";
      readonly proposal: TaskProposalDto;
    }
  | {
      readonly status: "needs_integration";
      readonly title: string;
      readonly explanation: string;
      readonly missingCapability: string;
      readonly suggestedIntegration?: string;
      readonly supportedAlternative?: string;
    }
  | {
      readonly status: "unsupported";
      readonly title: string;
      readonly explanation: string;
      readonly supportedAlternative?: string;
    };

export interface ConnectionCardDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: "connected" | "not_connected" | "coming_soon";
  readonly category?: "connector" | "web-search";
  readonly endpoint?: string;
  readonly toolCount?: number;
  readonly tools?: readonly {
    readonly name: string;
    readonly effect: "read" | "write" | "destructive";
  }[];
  readonly credentialKind?: "oauth" | "api-key" | "none";
  readonly credentialPlaceholder?: string;
  readonly operator?: string;
  readonly oauthReady?: boolean;
  readonly availableIn?: readonly ("local" | "hosted")[];
  readonly keyCreationUrl?: string;
  readonly credentialConfigured?: boolean;
  readonly logoSvg?: string;
}

export interface AppSnapshotDto {
  readonly runs: readonly RunSummaryDto[];
  readonly tasks: readonly TaskSummaryDto[];
  readonly connections: readonly ConnectionCardDto[];
}
