import type {
  AppSnapshotDto,
  ChatDetailDto,
  ChatSessionDto,
  ChatSessionEntryDto,
  ConnectionCardDto,
  ConnectionDetailDto,
  ConnectionWorkflowActionDto,
  ConnectorCredentialInputDto,
  ConnectorOAuthStartDto,
  ConnectorToolMode,
  IntegrationProposalOutcomeDto,
  ModelExecutionDto,
  ModelProviderDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelSettingsDto,
  RecipeConversationRunDto,
  RunDetailDto,
  RunEventDto,
  RunEventPageDto,
  RunStartDto,
  RunSummaryDto,
  TaskRecipeKnowledgeDto,
  TaskSummaryDto,
  TaskToolRepairProposalDto,
  TaskToolRepairProposalOutcomeDto,
} from "../shared.ts";

export const api = {
  chats: (includeArchived = false) =>
    request<readonly ChatSessionDto[]>(
      `/api/chats?includeArchived=${includeArchived}`,
    ),
  allChats: () =>
    request<readonly ChatSessionDto[]>("/api/chats?includeArchived=true"),
  createChat: (title?: string) =>
    request<ChatSessionDto>("/api/chats", {
      method: "POST",
      body: JSON.stringify({ ...(title ? { title } : undefined) }),
    }),
  enterChat: (input: ChatSessionEntryDto) =>
    request<ChatSessionDto>("/api/chats/entry", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  chat: (id: string) =>
    request<ChatDetailDto>(`/api/chats/${encodeURIComponent(id)}`),
  updateChat: (
    id: string,
    update: {
      readonly title?: string;
      readonly status?: "active";
      readonly modelSelection?: ModelSelectionDto | null;
    },
  ) =>
    request<ChatSessionDto>(`/api/chats/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  updateChatContext: (id: string, context: ChatSessionEntryDto["context"]) =>
    request<ChatSessionDto>(`/api/chats/${encodeURIComponent(id)}/context`, {
      method: "PUT",
      body: JSON.stringify(context),
    }),
  prepareConnectionWorkflow: (
    sessionId: string,
    workflowId: string,
    variantId: string,
  ) =>
    request<ConnectionWorkflowActionDto>(
      `/api/chats/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(workflowId)}/prepare-connection`,
      { method: "POST", body: JSON.stringify({ variantId }) },
    ),
  connectConnectionWorkflow: (
    sessionId: string,
    workflowId: string,
    credential: string | ConnectorCredentialInputDto,
  ) =>
    request<ConnectionWorkflowActionDto>(
      `/api/chats/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(workflowId)}/connect-key`,
      {
        method: "POST",
        body: JSON.stringify(
          typeof credential === "string" ? { apiKey: credential } : credential,
        ),
      },
    ),
  declineConnectionWorkflow: (sessionId: string, workflowId: string) =>
    request<ConnectionWorkflowActionDto>(
      `/api/chats/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(workflowId)}/decline-connection`,
      { method: "POST" },
    ),
  continueConnectionWorkflow: (sessionId: string, workflowId: string) =>
    request<{ readonly status: "continuing" }>(
      `/api/chats/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(workflowId)}/continue-connection`,
      { method: "POST" },
    ),
  archiveChat: (id: string) =>
    request<void>(`/api/chats/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  deleteChat: (id: string) =>
    request<void>(`/api/chats/${encodeURIComponent(id)}/permanent`, {
      method: "DELETE",
    }),
  cancelChat: (id: string) =>
    request<{ readonly cancelled: boolean }>(
      `/api/chats/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),
  snapshot: () => request<AppSnapshotDto>("/api/snapshot"),
  runs: () => request<readonly RunSummaryDto[]>("/api/runs"),
  run: (id: string) => request<RunDetailDto>(`/api/runs/${id}`),
  cancelRun: (id: string) =>
    request<{ readonly cancelled: boolean }>(
      `/api/runs/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),
  decideRunApprovals: (
    id: string,
    approvals: readonly {
      readonly id: string;
      readonly approved: boolean;
      readonly reason?: string;
    }[],
  ) =>
    request<RunDetailDto>(`/api/runs/${id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ approvals }),
    }),
  deleteRun: (id: string) =>
    request<void>(`/api/runs/${id}`, { method: "DELETE" }),
  runEvents: (id: string, after = -1) =>
    request<RunEventPageDto>(`/api/runs/${id}/events?after=${after}`),
  subscribeToRunEvents: (
    id: string,
    callbacks: RunEventCallbacks,
  ): (() => void) => subscribeToRunEvents(id, callbacks),
  tasks: () => request<readonly TaskSummaryDto[]>("/api/tasks"),
  task: (id: string) => request<TaskSummaryDto>(`/api/tasks/${id}`),
  taskRuns: (id: string, limit = 25) =>
    request<readonly RecipeConversationRunDto[]>(
      `/api/tasks/${encodeURIComponent(id)}/runs?limit=${limit}`,
    ),
  deleteTask: (id: string) =>
    request<void>(`/api/tasks/${id}`, { method: "DELETE" }),
  taskExecution: (id: string) =>
    request<ModelExecutionDto>(`/api/tasks/${id}/execution`),
  taskRecipeKnowledge: (id: string) =>
    request<TaskRecipeKnowledgeDto | null>(`/api/tasks/${id}/knowledge`),
  connections: () => request<readonly ConnectionCardDto[]>("/api/connections"),
  connection: (id: string) =>
    request<ConnectionDetailDto>(`/api/connections/${encodeURIComponent(id)}`),
  updateConnectionToolPolicy: (
    id: string,
    toolName: string,
    mode: ConnectorToolMode,
  ) =>
    request<ConnectionDetailDto>(
      `/api/connections/${encodeURIComponent(id)}/tools/${encodeURIComponent(toolName)}`,
      { method: "PATCH", body: JSON.stringify({ mode }) },
    ),
  proposeIntegration: (sentence: string) =>
    request<IntegrationProposalOutcomeDto>("/api/integrations/propose", {
      method: "POST",
      body: JSON.stringify({ sentence }),
    }),
  prepareIntegrationVariant: (templateId: string, variantId: string) =>
    request<ConnectionCardDto>(
      `/api/integrations/${encodeURIComponent(templateId)}/select`,
      {
        method: "POST",
        body: JSON.stringify({ variantId }),
      },
    ),
  prepareCustomRemoteMcp: (input: {
    readonly name?: string;
    readonly endpoint: string;
    readonly credentialKind: "oauth" | "api-key" | "none";
    readonly header?: string;
  }) =>
    request<ConnectionCardDto>("/api/connectors/custom", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  prepareImportedRemoteMcp: (input: {
    readonly configuration: string;
    readonly name?: string;
    readonly credentialKind: "oauth" | "api-key" | "none";
    readonly header?: string;
  }) =>
    request<ConnectionCardDto>("/api/connectors/import/mcp", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  prepareCustomOpenApi: (input: {
    readonly name?: string;
    readonly specUrl: string;
    readonly keyCreationUrl?: string;
    readonly credentialPlaceholder?: string;
  }) =>
    request<ConnectionCardDto>("/api/connectors/custom/openapi", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  models: () => request<ModelSettingsDto>("/api/models"),
  refreshModels: () =>
    request<ModelSettingsDto>("/api/models/refresh", { method: "POST" }),
  updateTask: (
    id: string,
    update: {
      readonly enabled?: boolean;
      readonly name?: string;
      readonly prompt?: string;
      readonly schedule?: string;
      readonly timezone?: string;
      readonly tag?: string | null;
      readonly catchUpPolicy?: "catch_up" | "skip_to_next";
      readonly modelSelection?: ModelSelectionDto | null;
      readonly imageModelSelection?: ModelSelectionDto | null;
    },
  ) =>
    request<TaskSummaryDto>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  repairTaskTools: (id: string, proposal: TaskToolRepairProposalDto) =>
    request<TaskSummaryDto>(`/api/tasks/${id}/repair-tools`, {
      method: "POST",
      body: JSON.stringify(proposal),
    }),
  taskToolRepair: (id: string) =>
    request<TaskToolRepairProposalOutcomeDto>(`/api/tasks/${id}/tool-repair`),
  runTask: (id: string) =>
    request<RunStartDto>(`/api/tasks/${id}/run`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
    }),
  connectOpenRouter: (apiKey: string) =>
    request<ConnectionCardDto>("/api/connections/openrouter", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  disconnectOpenRouter: () =>
    request<void>("/api/connections/openrouter", {
      method: "DELETE",
    }),
  connectWebSearch: (apiKey: string) =>
    request<ConnectionCardDto>("/api/connections/web-search", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  disconnectWebSearch: () =>
    request<void>("/api/connections/web-search", {
      method: "DELETE",
    }),
  connectConnector: (
    manifestId: string,
    credential?: string | ConnectorCredentialInputDto,
  ) =>
    request<ConnectionCardDto>(
      `/api/connectors/${encodeURIComponent(manifestId)}`,
      {
        method: "POST",
        body: JSON.stringify(
          typeof credential === "string"
            ? { apiKey: credential }
            : (credential ?? {}),
        ),
      },
    ),
  disconnectConnector: (manifestId: string) =>
    request<void>(
      `/api/connectors/${encodeURIComponent(manifestId)}/disconnect`,
      {
        method: "POST",
      },
    ),
  enableConnectionHosted: (connectionId: string) =>
    request<ConnectionCardDto>(
      `/api/connectors/${encodeURIComponent(connectionId)}/hosted-credential`,
      { method: "POST" },
    ),
  disableConnectionHosted: (connectionId: string) =>
    request<ConnectionCardDto>(
      `/api/connectors/${encodeURIComponent(connectionId)}/hosted-credential`,
      { method: "DELETE" },
    ),
  removeConnector: (manifestId: string) =>
    request<void>(`/api/connectors/${encodeURIComponent(manifestId)}`, {
      method: "DELETE",
    }),
  renameConnection: (connectionId: string, name: string) =>
    request<ConnectionCardDto>(
      `/api/connectors/${encodeURIComponent(connectionId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      },
    ),
  startConnectorOAuth: (
    manifestId: string,
    returnTo?: string,
    permissionSet?: string,
  ) =>
    request<ConnectorOAuthStartDto>(
      `/api/connectors/${encodeURIComponent(manifestId)}/oauth`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(returnTo ? { returnTo } : undefined),
          ...(permissionSet ? { permissionSet } : undefined),
        }),
      },
    ),
  connectModelProvider: (providerId: ModelProviderId, apiKey: string) =>
    request<ModelProviderDto>(`/api/model-providers/${providerId}`, {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  disconnectModelProvider: (providerId: ModelProviderId) =>
    request<void>(`/api/model-providers/${providerId}`, {
      method: "DELETE",
    }),
  updateDefaultModel: (selection: ModelSelectionDto | null) =>
    request<ModelSettingsDto>("/api/models/default", {
      method: "PUT",
      body: JSON.stringify({ selection }),
    }),
  updateResearchDistillerModel: (selection: ModelSelectionDto | null) =>
    request<ModelSettingsDto>("/api/models/research-distiller", {
      method: "PUT",
      body: JSON.stringify({ selection }),
    }),
  updateImageModel: (selection: ModelSelectionDto | null) =>
    request<ModelSettingsDto>("/api/models/image", {
      method: "PUT",
      body: JSON.stringify({ selection }),
    }),
  connectNeon: (url: string, token: string) =>
    request<ConnectionCardDto>("/api/connections/neon", {
      method: "POST",
      body: JSON.stringify({
        url,
        ...(token ? { token } : undefined),
      }),
    }),
  disconnectNeon: () =>
    request<void>("/api/connections/neon", {
      method: "DELETE",
    }),
};

interface RunEventCallbacks {
  readonly onEvent: (event: RunEventDto) => void;
  readonly onComplete: () => void;
}

function subscribeToRunEvents(
  runId: string,
  callbacks: RunEventCallbacks,
): () => void {
  const source = new EventSource(
    `/api/runs/${encodeURIComponent(runId)}/events/stream`,
  );
  source.addEventListener("run_event", (message) => {
    try {
      callbacks.onEvent(JSON.parse(message.data) as RunEventDto);
    } catch {
      // Ignore malformed progress events and let persisted replay recover.
    }
  });
  source.addEventListener("run_complete", () => {
    source.close();
    callbacks.onComplete();
  });
  return () => source.close();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : undefined),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { readonly error?: string }
      | undefined;
    throw new Error(
      body?.error ?? `Request failed with HTTP ${response.status}`,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
