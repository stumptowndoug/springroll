import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import type { CredentialStore } from "../credentials.ts";
import {
  HttpStatusError,
  InvalidResponseError,
  type RetryOptions,
  withRetry,
} from "../failures.ts";
import { type FetchApi, MissingCredentialError } from "./openai.ts";

export const standardModelProviderIds = [
  "anthropic",
  "google",
  "groq",
] as const;

export type StandardModelProviderId = (typeof standardModelProviderIds)[number];

export function isStandardModelProviderId(
  value: string,
): value is StandardModelProviderId {
  return standardModelProviderIds.includes(value as StandardModelProviderId);
}

export interface StandardModelProviderDefinition {
  readonly id: StandardModelProviderId;
  readonly name: string;
  readonly defaultModelId: string;
  readonly credentialRef: string;
  readonly keyCreationUrl: string;
  readonly keyPlaceholder: string;
}

export const standardModelProviderDefinitions: Readonly<
  Record<StandardModelProviderId, StandardModelProviderDefinition>
> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    defaultModelId: "claude-sonnet-4-6",
    credentialRef: "anthropic-default",
    keyCreationUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
  },
  google: {
    id: "google",
    name: "Google AI",
    defaultModelId: "gemini-3.7-flash",
    credentialRef: "google-ai-default",
    keyCreationUrl: "https://aistudio.google.com/api-keys",
    keyPlaceholder: "AIza…",
  },
  groq: {
    id: "groq",
    name: "Groq",
    defaultModelId: "openai/gpt-oss-120b",
    credentialRef: "groq-default",
    keyCreationUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
  },
} as const;

export interface StandardModelConnectionOptions {
  readonly fetch?: FetchApi;
  readonly retry?: RetryOptions;
}

export interface StandardModelConnectionRequest {
  readonly providerId: StandardModelProviderId;
  readonly apiKey: string;
  readonly modelId?: string;
  readonly workspaceId?: string | undefined;
}

export interface StandardModelConnectionTestResult {
  readonly provider: StandardModelProviderId;
  readonly modelId: string;
}

/** API-key model providers that need no Springroll-specific runtime behavior. */
export class StandardModelConnection {
  readonly #fetch: FetchApi;
  readonly #retry: RetryOptions | undefined;

  constructor(
    private readonly credentials: CredentialStore,
    options: StandardModelConnectionOptions = {},
  ) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#retry = options.retry;
  }

  async connect(
    request: StandardModelConnectionRequest,
  ): Promise<StandardModelConnectionTestResult> {
    const apiKey = validateApiKey(request.providerId, request.apiKey);
    const workspaceId = validateWorkspaceId(request.workspaceId);
    if (workspaceId && request.providerId !== "anthropic") {
      throw new TypeError("Workspace ID is only supported for Anthropic");
    }
    const definition = standardModelProviderDefinitions[request.providerId];
    const result = await this.#testApiKey(
      request.providerId,
      apiKey,
      request.modelId ?? definition.defaultModelId,
      workspaceId,
    );
    await this.credentials.put(
      definition.credentialRef,
      workspaceId ? JSON.stringify({ apiKey, workspaceId }) : apiKey,
    );
    return result;
  }

  async test(
    providerId: StandardModelProviderId,
    modelId = standardModelProviderDefinitions[providerId].defaultModelId,
  ): Promise<StandardModelConnectionTestResult> {
    const definition = standardModelProviderDefinitions[providerId];
    const stored = await this.credentials.get(definition.credentialRef);
    if (!stored) {
      throw new MissingCredentialError(
        `No ${definition.name} API key found for ${definition.credentialRef}`,
      );
    }
    const { apiKey, workspaceId } = readCredential(providerId, stored);
    return this.#testApiKey(providerId, apiKey, modelId, workspaceId);
  }

  async loadModel(
    providerId: StandardModelProviderId,
    modelId = standardModelProviderDefinitions[providerId].defaultModelId,
  ): Promise<LanguageModel> {
    const definition = standardModelProviderDefinitions[providerId];
    const stored = await this.credentials.get(definition.credentialRef);
    if (!stored) {
      throw new MissingCredentialError(
        `No ${definition.name} API key found for ${definition.credentialRef}`,
      );
    }
    const { apiKey, workspaceId } = readCredential(providerId, stored);
    const fetch = this.#fetch as typeof globalThis.fetch;
    if (providerId === "anthropic") {
      return createAnthropic({
        apiKey,
        fetch,
        ...(workspaceId
          ? { headers: { "anthropic-workspace-id": workspaceId } }
          : {}),
      }).languageModel(modelId);
    }
    if (providerId === "google") {
      return createGoogle({ apiKey, fetch }).languageModel(modelId);
    }
    return createGroq({ apiKey, fetch }).languageModel(modelId);
  }

  async disconnect(providerId: StandardModelProviderId): Promise<void> {
    await this.credentials.delete(
      standardModelProviderDefinitions[providerId].credentialRef,
    );
  }

  async #testApiKey(
    providerId: StandardModelProviderId,
    apiKey: string,
    modelId: string,
    workspaceId?: string,
  ): Promise<StandardModelConnectionTestResult> {
    const request = verificationRequest(
      providerId,
      apiKey,
      modelId,
      workspaceId,
    );
    const response = await withRetry(async () => {
      const attempt = await this.#fetch(request.url, {
        headers: request.headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!attempt.ok) {
        if (
          providerId === "anthropic" &&
          attempt.status === 400 &&
          !workspaceId
        ) {
          const body: unknown = await attempt.json().catch(() => undefined);
          if (JSON.stringify(body)?.includes("anthropic-workspace-id")) {
            throw new HttpStatusError(
              400,
              "This Anthropic key requires a Workspace ID. Find it in Claude Console → Settings → Workspaces, then enter it below your API key.",
            );
          }
        }
        throw new HttpStatusError(
          attempt.status,
          `${standardModelProviderDefinitions[providerId].name} connection test failed with HTTP ${attempt.status}`,
        );
      }
      return attempt;
    }, this.#retry);
    const returnedModelId = readVerifiedModelId(
      providerId,
      modelId,
      (await response.json()) as unknown,
    );
    return { provider: providerId, modelId: returnedModelId };
  }
}

function verificationRequest(
  providerId: StandardModelProviderId,
  apiKey: string,
  modelId: string,
  workspaceId?: string,
): {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
} {
  if (providerId === "anthropic") {
    return {
      url: `https://api.anthropic.com/v1/models/${encodeURIComponent(modelId)}`,
      headers: {
        accept: "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
        ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
      },
    };
  }
  if (providerId === "google") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}`,
      headers: { accept: "application/json", "x-goog-api-key": apiKey },
    };
  }
  return {
    url: "https://api.groq.com/openai/v1/models",
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  };
}

function validateWorkspaceId(value: string | undefined): string | undefined {
  const workspaceId = value?.trim();
  if (!workspaceId) return undefined;
  if (!/^wrkspc_[A-Za-z0-9]+$/.test(workspaceId) || workspaceId.length > 128) {
    throw new TypeError(
      "Enter a valid Anthropic Workspace ID starting with wrkspc_",
    );
  }
  return workspaceId;
}

function readCredential(
  providerId: StandardModelProviderId,
  stored: string,
): {
  apiKey: string;
  workspaceId?: string | undefined;
} {
  // Existing installations store a plain key; workspace-aware keys are one
  // Keychain entry so replacement and deletion cannot leave mismatched values.
  if (providerId !== "anthropic" || !stored.startsWith("{"))
    return { apiKey: stored };
  try {
    const value = JSON.parse(stored);
    if (
      typeof value.apiKey !== "string" ||
      typeof value.workspaceId !== "string"
    )
      throw new Error();
    return {
      apiKey: validateApiKey(providerId, value.apiKey),
      workspaceId: validateWorkspaceId(value.workspaceId),
    };
  } catch {
    throw new TypeError(
      "Saved Anthropic credentials are invalid. Reconnect the provider in Settings.",
    );
  }
}

function readVerifiedModelId(
  providerId: StandardModelProviderId,
  requestedModelId: string,
  body: unknown,
): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidProviderResponse(providerId);
  }
  if (providerId === "google") {
    const name = Reflect.get(body, "name");
    if (typeof name === "string" && name === `models/${requestedModelId}`) {
      return requestedModelId;
    }
    throw invalidProviderResponse(providerId);
  }
  if (providerId === "groq") {
    const data = Reflect.get(body, "data");
    if (
      Array.isArray(data) &&
      data.some(
        (model) =>
          model &&
          typeof model === "object" &&
          Reflect.get(model, "id") === requestedModelId,
      )
    ) {
      return requestedModelId;
    }
    throw invalidProviderResponse(providerId);
  }
  const id = Reflect.get(body, "id");
  if (typeof id !== "string" || id.length === 0) {
    throw invalidProviderResponse(providerId);
  }
  return id;
}

function invalidProviderResponse(
  providerId: StandardModelProviderId,
): InvalidResponseError {
  return new InvalidResponseError(
    `${standardModelProviderDefinitions[providerId].name} returned an invalid model response`,
  );
}

function validateApiKey(
  providerId: StandardModelProviderId,
  apiKey: string,
): string {
  const normalized = apiKey.trim();
  if (normalized === "" || normalized.includes("\n")) {
    throw new TypeError(
      `${standardModelProviderDefinitions[providerId].name} API key must be a non-empty single line`,
    );
  }
  return normalized;
}
