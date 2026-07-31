import type {
  AppSnapshotDto,
  ConnectionCardDto,
  ModelProviderDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelSettingsDto,
  RunDetailDto,
  RunSummaryDto,
  TaskProposalDto,
  TaskSummaryDto,
} from "../shared.ts";

export const api = {
  snapshot: () => request<AppSnapshotDto>("/api/snapshot"),
  runs: () => request<readonly RunSummaryDto[]>("/api/runs"),
  run: (id: string) => request<RunDetailDto>(`/api/runs/${id}`),
  tasks: () => request<readonly TaskSummaryDto[]>("/api/tasks"),
  task: (id: string) => request<TaskSummaryDto>(`/api/tasks/${id}`),
  connections: () => request<readonly ConnectionCardDto[]>("/api/connections"),
  models: () => request<ModelSettingsDto>("/api/models"),
  proposeTask: (sentence: string, timezone: string) =>
    request<TaskProposalDto>("/api/tasks/propose", {
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
      readonly catchUpPolicy?: "catch_up" | "skip_to_next";
      readonly modelSelection?: ModelSelectionDto | null;
    },
  ) =>
    request<TaskSummaryDto>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  runTask: (id: string) =>
    request<RunDetailDto>(`/api/tasks/${id}/run`, {
      method: "POST",
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
