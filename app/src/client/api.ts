import type {
  AppSnapshotDto,
  ConnectionCardDto,
  ModelExecutionDto,
  ModelProviderDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelSettingsDto,
  RunDetailDto,
  RunEventDto,
  RunEventPageDto,
  RunStartDto,
  RunSummaryDto,
  TaskProposalDto,
  TaskProposalOutcomeDto,
  TaskSummaryDto,
} from "../shared.ts";

export const api = {
  snapshot: () => request<AppSnapshotDto>("/api/snapshot"),
  runs: () => request<readonly RunSummaryDto[]>("/api/runs"),
  run: (id: string) => request<RunDetailDto>(`/api/runs/${id}`),
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
  deleteTask: (id: string) =>
    request<void>(`/api/tasks/${id}`, { method: "DELETE" }),
  taskExecution: (id: string) =>
    request<ModelExecutionDto>(`/api/tasks/${id}/execution`),
  connections: () => request<readonly ConnectionCardDto[]>("/api/connections"),
  models: () => request<ModelSettingsDto>("/api/models"),
  proposeTask: (sentence: string, timezone: string) =>
    request<TaskProposalOutcomeDto>("/api/tasks/propose", {
      method: "POST",
      body: JSON.stringify({ sentence, timezone }),
    }),
  createTask: (proposal: TaskProposalDto, enabled: boolean) =>
    request<TaskSummaryDto>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ proposal, enabled }),
    }),
  updateTask: (
    id: string,
    update: {
      readonly enabled?: boolean;
      readonly tag?: string | null;
      readonly catchUpPolicy?: "catch_up" | "skip_to_next";
      readonly modelSelection?: ModelSelectionDto | null;
    },
  ) =>
    request<TaskSummaryDto>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
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
  connectConnector: (manifestId: string, apiKey?: string) =>
    request<ConnectionCardDto>(
      `/api/connectors/${encodeURIComponent(manifestId)}`,
      {
        method: "POST",
        body: JSON.stringify({ ...(apiKey ? { apiKey } : undefined) }),
      },
    ),
  disconnectConnector: (manifestId: string) =>
    request<void>(`/api/connectors/${encodeURIComponent(manifestId)}`, {
      method: "DELETE",
    }),
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
