import { createAnthropic } from "@ai-sdk/anthropic";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
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
  "mistral",
  "groq",
  "deepseek",
  "cohere",
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
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    defaultModelId: "mistral-medium-latest",
    credentialRef: "mistral-default",
    keyCreationUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "Your Mistral API key",
  },
  groq: {
    id: "groq",
    name: "Groq",
    defaultModelId: "openai/gpt-oss-120b",
    credentialRef: "groq-default",
    keyCreationUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    defaultModelId: "deepseek-v4-flash",
    credentialRef: "deepseek-default",
    keyCreationUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-…",
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    defaultModelId: "command-a-03-2025",
    credentialRef: "cohere-default",
    keyCreationUrl: "https://dashboard.cohere.com/api-keys",
    keyPlaceholder: "Your Cohere API key",
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
    const definition = standardModelProviderDefinitions[request.providerId];
    const result = await this.#testApiKey(
      request.providerId,
      apiKey,
      request.modelId ?? definition.defaultModelId,
    );
    await this.credentials.put(definition.credentialRef, apiKey);
    return result;
  }

  async test(
    providerId: StandardModelProviderId,
    modelId = standardModelProviderDefinitions[providerId].defaultModelId,
  ): Promise<StandardModelConnectionTestResult> {
    const definition = standardModelProviderDefinitions[providerId];
    const apiKey = await this.credentials.get(definition.credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No ${definition.name} API key found for ${definition.credentialRef}`,
      );
    }
    return this.#testApiKey(providerId, apiKey, modelId);
  }

  async loadModel(
    providerId: StandardModelProviderId,
    modelId = standardModelProviderDefinitions[providerId].defaultModelId,
  ): Promise<LanguageModel> {
    const definition = standardModelProviderDefinitions[providerId];
    const apiKey = await this.credentials.get(definition.credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No ${definition.name} API key found for ${definition.credentialRef}`,
      );
    }
    const fetch = this.#fetch as typeof globalThis.fetch;
    if (providerId === "anthropic") {
      return createAnthropic({ apiKey, fetch }).languageModel(modelId);
    }
    if (providerId === "google") {
      return createGoogle({ apiKey, fetch }).languageModel(modelId);
    }
    if (providerId === "mistral") {
      return createMistral({ apiKey, fetch }).languageModel(modelId);
    }
    if (providerId === "groq") {
      return createGroq({ apiKey, fetch }).languageModel(modelId);
    }
    if (providerId === "deepseek") {
      return createDeepSeek({ apiKey, fetch }).languageModel(modelId);
    }
    return createCohere({ apiKey, fetch }).languageModel(modelId);
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
  ): Promise<StandardModelConnectionTestResult> {
    const request = verificationRequest(providerId, apiKey, modelId);
    const response = await withRetry(async () => {
      const attempt = await this.#fetch(request.url, {
        headers: request.headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!attempt.ok) {
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
      },
    };
  }
  if (providerId === "google") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}`,
      headers: { accept: "application/json", "x-goog-api-key": apiKey },
    };
  }
  const baseUrl =
    providerId === "mistral"
      ? "https://api.mistral.ai/v1"
      : providerId === "groq"
        ? "https://api.groq.com/openai/v1"
        : providerId === "deepseek"
          ? "https://api.deepseek.com"
          : "https://api.cohere.com/v1";
  const path =
    providerId === "cohere"
      ? "/models?page_size=1000&endpoint=chat"
      : providerId === "deepseek" || providerId === "groq"
        ? "/models"
        : `/models/${encodeURIComponent(modelId)}`;
  return {
    url: `${baseUrl}${path}`,
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  };
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
  if (providerId === "deepseek" || providerId === "groq") {
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
  if (providerId === "cohere") {
    const models = Reflect.get(body, "models");
    if (
      Array.isArray(models) &&
      models.some(
        (model) =>
          model &&
          typeof model === "object" &&
          Reflect.get(model, "name") === requestedModelId,
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
