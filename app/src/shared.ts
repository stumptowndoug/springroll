import type {
  ChatSessionContext,
  ChatSessionEntryMode,
  ConnectionToolPolicyMode,
  ConnectorManifest,
  RecipeKnowledgeDocument,
  RecipeKnowledgeStatus,
  RunFailureCategory,
  RunResultV1,
} from "@springroll/kernel";
import type { UIMessage } from "ai";

export type RunStatus =
  | "claimed"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed";
export type CatchUpPolicy = "catch_up" | "skip_to_next";
export type TaskCapabilityMode = ConnectionToolPolicyMode;
export type ConnectorToolMode = ConnectionToolPolicyMode;
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
  readonly approvals: readonly ToolApprovalDto[];
  readonly requiredApprovalIds: readonly string[];
  /** A one-off run exhausted bounded retries and may be started again by the user. */
  readonly canRetry: boolean;
}

export interface RecipeConversationRunDto {
  readonly id: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly status: RunStatus;
  readonly scheduledTime: string;
  readonly executionLocation: "local" | "hosted";
  readonly report?: string;
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
  /** Complete recipe instructions in GitHub-flavored Markdown. */
  readonly prompt: string;
  readonly contract: string;
  readonly schedule: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly catchUpPolicy: CatchUpPolicy;
  readonly nextRunAt: string;
  readonly connectionNames: readonly string[];
  readonly capabilities: readonly {
    readonly connectionId: string;
    readonly connectionName: string;
    readonly toolName: string;
    readonly effect: "read" | "write" | "destructive";
    readonly mode: TaskCapabilityMode;
  }[];
  /** Statuses of the most recent runs, oldest first, at most seven. */
  readonly recentRunStatuses: readonly RunStatus[];
  readonly modelOverride?: ModelSelectionDto;
}

export interface TaskRecipeKnowledgeDto {
  readonly taskId: string;
  readonly revision: number;
  readonly status: RecipeKnowledgeStatus;
  readonly knowledge: RecipeKnowledgeDocument;
  readonly sourceRunId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProposalToolDto {
  readonly name: string;
  readonly description: string;
  readonly effect: "read" | "write" | "destructive";
  readonly approval: "never" | "before_call";
}

export interface TaskProposalDto {
  readonly title: string;
  /** Complete recipe instructions in GitHub-flavored Markdown. */
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

export interface DegradedConnectionDto {
  readonly id: string;
  readonly name: string;
}

export type TaskProposalOutcomeDto =
  | {
      readonly status: "ready";
      readonly proposal: TaskProposalDto;
      /** Connected entries the host could not open while building this proposal. */
      readonly degradedConnections?: readonly DegradedConnectionDto[];
    }
  | {
      readonly status: "needs_integration";
      readonly title: string;
      readonly explanation: string;
      readonly missingCapability: string;
      readonly suggestedIntegration?: string;
      readonly supportedAlternative?: string;
      /** Connected entries the host could not open while building this proposal. */
      readonly degradedConnections?: readonly DegradedConnectionDto[];
      /** Degraded connection IDs structurally matched to the user's request. */
      readonly degradedConnectionIds?: readonly string[];
    }
  | {
      readonly status: "unsupported";
      readonly title: string;
      readonly explanation: string;
      readonly supportedAlternative?: string;
      /** Connected entries the host could not open while building this proposal. */
      readonly degradedConnections?: readonly DegradedConnectionDto[];
    };

export interface TaskToolRepairProposalDto {
  readonly taskId: string;
  readonly taskName: string;
  readonly changes: readonly {
    readonly connectionId: string;
    readonly connectionName: string;
    readonly sourceId: string;
    readonly toolName: string;
    readonly description: string;
    readonly previousInputSchemaHash: string;
    readonly proposedInputSchemaHash: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly previousRisk: {
      readonly effect: "read" | "write" | "destructive";
      readonly openWorld: boolean;
      readonly idempotent: boolean;
    };
    readonly proposedRisk: {
      readonly effect: "read" | "write" | "destructive";
      readonly openWorld: boolean;
      readonly idempotent: boolean;
    };
  }[];
}

export type TaskToolRepairProposalOutcomeDto =
  | {
      readonly status: "ready";
      readonly proposal: TaskToolRepairProposalDto;
    }
  | {
      readonly status: "not_found" | "not_needed" | "unavailable";
      readonly title: string;
      readonly explanation: string;
    };

export type ConnectionAction = "reconnect" | "disconnect" | "remove";

export interface ConnectorCredentialFieldDto {
  readonly name: "username" | "password";
  readonly label: string;
  readonly secret: boolean;
  readonly autoComplete: "username" | "current-password";
}

export interface ConnectorCredentialInputDto {
  readonly apiKey?: string | undefined;
  readonly fields?:
    | {
        readonly username?: string | undefined;
        readonly password?: string | undefined;
      }
    | undefined;
}

export interface ConnectionActionProposalDto {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly action: ConnectionAction;
  readonly expectedStatus: "connected" | "not_connected";
  readonly credentialKind: "oauth" | "api-key" | "none";
  readonly credentialConfigured: boolean;
  readonly removable: boolean;
  readonly toolCount: number;
}

export type ConnectionActionProposalOutcomeDto =
  | {
      readonly status: "ready";
      readonly proposal: ConnectionActionProposalDto;
    }
  | {
      readonly status: "not_found" | "unavailable";
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
  readonly credentialFields?: readonly ConnectorCredentialFieldDto[];
  readonly operator?: string;
  readonly oauthReady?: boolean;
  readonly featured?: boolean;
  readonly actionable?: boolean;
  readonly setupVariantId?: string;
  readonly availableIn?: readonly ("local" | "hosted")[];
  readonly keyCreationUrl?: string;
  readonly credentialConfigured?: boolean;
  readonly connectionIssue?: "credential_missing" | "credential_invalid";
  readonly logoSvg?: string;
  readonly logoUrl?: string;
  readonly logoSource?: "github-registry" | "github-repository" | "provider";
}

export interface ConnectionDetailDto extends ConnectionCardDto {
  readonly catalogSource: "live" | "last-discovered" | "unavailable";
  readonly tools: readonly {
    readonly name: string;
    readonly description?: string;
    readonly effect: "read" | "write" | "destructive";
    readonly mode: ConnectorToolMode;
  }[];
  readonly agentAccess: {
    readonly mode: "on-demand";
    readonly policySource: "connection";
    readonly catalogIncludes: "names-and-effects";
    readonly detailIncludes: "descriptions-and-schemas";
  };
  readonly credentialAudit: readonly {
    readonly id: string;
    readonly action:
      | "test"
      | "oauth_start"
      | "oauth_complete"
      | "revoke"
      | "remove";
    readonly status: "succeeded" | "failed";
    readonly failureCategory?: RunFailureCategory;
    readonly createdAt: string;
  }[];
}

export type ConnectorOAuthStartDto =
  | { readonly status: "redirect"; readonly authorizationUrl: string }
  | { readonly status: "connected"; readonly connection: ConnectionCardDto };

export type ConnectionWorkflowActionDto =
  | {
      readonly status: "declined";
    }
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
  readonly trust?:
    | "curated"
    | "registry-verified"
    | "provider-verified"
    | "package-verified"
    | "openapi-verified";
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
    readonly description?: string;
    readonly effect: "read" | "write" | "destructive";
  }[];
  readonly api?: {
    readonly specUrl: string;
    readonly baseUrl: string;
    readonly operationCount: number;
    readonly verification?: {
      readonly tool: string;
      readonly note: string;
    };
    readonly notes?: readonly string[];
  };
  /** Validated, secret-free setup data retained for durable researched proposals. */
  readonly manifest?: ConnectorManifest;
  readonly variants: readonly IntegrationVariantDto[];
}

export type IntegrationProposalOutcomeDto =
  | { readonly status: "ready"; readonly proposal: IntegrationProposalDto }
  | {
      readonly status: "candidate";
      readonly title: string;
      readonly explanation: string;
      readonly candidate: {
        readonly kind: "local-mcp";
        readonly name: string;
        readonly operator: string;
        readonly description: string;
        readonly packageName: string;
        readonly repositoryUrl: string;
        readonly registryUrl: string;
        readonly credentialRequired: boolean;
        readonly logo?: {
          readonly url: string;
          readonly source: "github-registry" | "github-repository";
          readonly kind: "preferred" | "owner-avatar" | "opengraph" | "asset";
          readonly format: "svg" | "raster";
        };
      };
      readonly instruction: string;
    }
  | {
      readonly status: "unavailable";
      readonly title: string;
      readonly explanation: string;
      readonly userAction?: "none" | "provide_source" | "retry";
    }
  | {
      readonly status: "not_found";
      readonly title: string;
      readonly explanation: string;
      readonly userAction?: "none" | "provide_source" | "retry";
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
  readonly kind: "connection_setup";
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

export interface ToolApprovalDto {
  readonly id: string;
  readonly contextKind: "chat" | "run";
  readonly contextId: string;
  readonly messageId: string | null;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly riskEffect: "read" | "write" | "destructive";
  readonly status:
    | "pending"
    | "approved"
    | "denied"
    | "executing"
    | "succeeded"
    | "failed"
    | "interrupted";
  readonly reason: string | null;
  readonly outcome: Readonly<Record<string, unknown>> | null;
  readonly decidedAt: string | null;
  readonly executionStartedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatDetailDto {
  readonly session: ChatSessionDto;
  readonly messages: readonly AssistantMessageDto[];
  readonly turns: readonly ChatTurnDto[];
  readonly workflows: readonly AssistantWorkflowDto[];
  readonly approvals: readonly ToolApprovalDto[];
  readonly usage: ChatUsageDto;
}
