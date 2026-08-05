import type {
  ChatSessionContext,
  ChatSessionEntryMode,
  ConnectorManifest,
  RunResultV1,
} from "@springroll/kernel";
import type { UIMessage } from "ai";

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

export interface TaskUpdateRecipeDto {
  readonly name: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly timezone: string;
  readonly catchUpPolicy: CatchUpPolicy;
}

export interface TaskUpdateProposalDto {
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly before: TaskUpdateRecipeDto;
  readonly after: TaskUpdateRecipeDto;
  readonly changes: readonly {
    readonly field:
      | "name"
      | "prompt"
      | "schedule"
      | "timezone"
      | "catchUpPolicy";
    readonly label: string;
    readonly before: string;
    readonly after: string;
  }[];
}

export type TaskUpdateProposalOutcomeDto =
  | {
      readonly status: "ready";
      readonly proposal: TaskUpdateProposalDto;
    }
  | {
      readonly status: "not_found" | "unchanged";
      readonly title: string;
      readonly explanation: string;
    };

export interface ConnectionCardDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: "connected" | "not_connected" | "coming_soon";
  readonly category?: "connector" | "web-search";
  readonly connectionType?: "mcp" | "api" | "local";
  readonly custom?: boolean;
  readonly installed?: boolean;
  readonly removable?: boolean;
  readonly tags?: readonly string[];
  readonly endpoint?: string;
  readonly toolCount?: number;
  readonly tools?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly effect: "read" | "write" | "destructive";
  }[];
  readonly credentialKind?: "oauth" | "api-key" | "none";
  readonly credentialPlaceholder?: string;
  readonly operator?: string;
  readonly oauthReady?: boolean;
  readonly featured?: boolean;
  readonly actionable?: boolean;
  readonly setupVariantId?: string;
  readonly availableIn?: readonly ("local" | "hosted")[];
  readonly keyCreationUrl?: string;
  readonly credentialConfigured?: boolean;
  readonly logoSvg?: string;
}

export interface ConnectionDetailDto extends ConnectionCardDto {
  readonly catalogSource: "live" | "last-discovered" | "unavailable";
  readonly tools: readonly {
    readonly name: string;
    readonly description?: string;
    readonly effect: "read" | "write" | "destructive";
  }[];
  readonly agentAccess: {
    readonly mode: "on-demand";
    readonly catalogIncludes: "names-and-effects";
    readonly detailIncludes: "descriptions-and-schemas";
    readonly directEffects: readonly ["read"];
    readonly approvalEffects: readonly ["write", "destructive"];
  };
}

export type ConnectorOAuthStartDto =
  | { readonly status: "redirect"; readonly authorizationUrl: string }
  | { readonly status: "connected"; readonly connection: ConnectionCardDto };

export type ConnectionWorkflowActionDto =
  | {
      readonly status: "awaiting_api_key";
      readonly connection: ConnectionCardDto;
    }
  | {
      readonly status: "redirect";
      readonly authorizationUrl: string;
      readonly connection: ConnectionCardDto;
    }
  | {
      readonly status: "connected";
      readonly connection: ConnectionCardDto;
    };

export interface IntegrationVariantDto {
  readonly id: string;
  readonly label: string;
  readonly recommended: boolean;
  readonly credentialKind: "oauth" | "api-key" | "none";
  readonly guidance: {
    readonly summary: string;
    readonly steps: readonly string[];
    readonly docsUrl: string;
  };
}

export interface IntegrationProposalDto {
  readonly templateId: string;
  readonly name: string;
  readonly description: string;
  readonly operator: string;
  readonly trust?: "curated" | "registry-verified" | "package-verified";
  readonly registryName?: string;
  readonly registryVersion?: string;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly packageArgs?: readonly string[];
  readonly sources?: readonly {
    readonly title: string;
    readonly url: string;
  }[];
  readonly tools?: readonly {
    readonly name: string;
    readonly effect: "read" | "write" | "destructive";
  }[];
  /** Validated, secret-free setup data retained for durable researched proposals. */
  readonly manifest?: ConnectorManifest;
  readonly variants: readonly IntegrationVariantDto[];
}

export type IntegrationProposalOutcomeDto =
  | { readonly status: "ready"; readonly proposal: IntegrationProposalDto }
  | {
      readonly status: "unavailable";
      readonly title: string;
      readonly explanation: string;
    }
  | {
      readonly status: "not_found";
      readonly title: string;
      readonly explanation: string;
    };

export interface AppSnapshotDto {
  readonly runs: readonly RunSummaryDto[];
  readonly tasks: readonly TaskSummaryDto[];
  readonly connections: readonly ConnectionCardDto[];
}

export interface AssistantMessageMetadataDto {
  readonly createdAt?: string;
  readonly turnId?: string;
  readonly provider?: string;
  readonly modelId?: string;
}

export type AssistantMessageDto = UIMessage<AssistantMessageMetadataDto>;

export type ChatSessionContextDto = ChatSessionContext;

export interface ChatSessionEntryDto {
  readonly title?: string;
  readonly mode?: ChatSessionEntryMode;
  readonly context: ChatSessionContextDto;
}

export interface ChatSessionDto {
  readonly id: string;
  readonly title: string | null;
  readonly status: "active" | "archived";
  readonly context: ChatSessionContextDto | null;
  readonly activeTurnId: string | null;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatUsageDto {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cachedInputTokens: number;
  readonly totalTokens: number;
  readonly actualCostUsdMicros: number;
  readonly estimatedCostUsdMicros: number;
  readonly webSearchRequests: number;
  readonly providerToolCalls: number;
}

export interface ChatTurnDto {
  readonly id: string;
  readonly sessionId: string;
  readonly status:
    | "queued"
    | "streaming"
    | "waiting_for_user"
    | "completed"
    | "failed"
    | "cancelled";
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly usage: ChatUsageDto;
}

export interface AssistantWorkflowDto {
  readonly id: string;
  readonly sessionId: string;
  readonly sourceMessageId: string;
  readonly sourceToolCallId: string;
  readonly kind: "connection_setup" | "task_proposal" | "task_update";
  readonly status:
    | "proposed"
    | "in_progress"
    | "waiting_for_user"
    | "completed"
    | "failed"
    | "cancelled";
  readonly schemaVersion: 1;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly outcome: Readonly<Record<string, unknown>> | null;
  readonly subjectKind: "connection" | "task" | "run" | null;
  readonly subjectId: string | null;
  readonly error: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatDetailDto {
  readonly session: ChatSessionDto;
  readonly messages: readonly AssistantMessageDto[];
  readonly turns: readonly ChatTurnDto[];
  readonly workflows: readonly AssistantWorkflowDto[];
  readonly usage: ChatUsageDto;
}
