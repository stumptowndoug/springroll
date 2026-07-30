import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import type { CredentialStore } from "../credentials.ts";
import {
  HttpStatusError,
  InvalidResponseError,
  type RetryOptions,
  withRetry,
} from "../failures.ts";

export const openAiApiKeyCreationUrl = "https://platform.openai.com/api-keys";
export const defaultOpenAiModelId = "gpt-5.6-sol";
export const defaultOpenAiModelPricing = {
  inputUsdPerMillionTokens: 5,
  outputUsdPerMillionTokens: 30,
} as const;

export class MissingCredentialError extends Error {
  override readonly name = "MissingCredentialError";
}

export interface OpenAiModelConnectionOptions {
  readonly fetch?: FetchApi;
  readonly retry?: RetryOptions;
}

export interface OpenAiConnectionRequest {
  readonly credentialRef: string;
  readonly apiKey: string;
  readonly modelId?: string;
}

export interface OpenAiConnectionTestResult {
  readonly provider: "openai";
  readonly modelId: string;
}

export type FetchApi = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export class OpenAiModelConnection {
  readonly #fetch: FetchApi;
  readonly #retry: RetryOptions | undefined;

  constructor(
    private readonly credentials: CredentialStore,
    options: OpenAiModelConnectionOptions = {},
  ) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#retry = options.retry;
  }

  async connect(
    request: OpenAiConnectionRequest,
  ): Promise<OpenAiConnectionTestResult> {
    const apiKey = validateApiKey(request.apiKey);
    const modelId = request.modelId ?? defaultOpenAiModelId;
    const result = await this.testApiKey(apiKey, modelId);
    await this.credentials.put(request.credentialRef, apiKey);

    return result;
  }

  async test(
    credentialRef: string,
    modelId = defaultOpenAiModelId,
  ): Promise<OpenAiConnectionTestResult> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No OpenAI API key found for ${credentialRef}`,
      );
    }

    return this.testApiKey(apiKey, modelId);
  }

  async loadModel(
    credentialRef: string,
    modelId = defaultOpenAiModelId,
  ): Promise<ReturnType<OpenAIProvider["responses"]>> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No OpenAI API key found for ${credentialRef}`,
      );
    }

    return createOpenAI({ apiKey }).responses(modelId);
  }

  async disconnect(credentialRef: string): Promise<void> {
    await this.credentials.delete(credentialRef);
  }

  private async testApiKey(
    apiKey: string,
    modelId: string,
  ): Promise<OpenAiConnectionTestResult> {
    const response = await withRetry(async () => {
      const attempt = await this.#fetch(
        `https://api.openai.com/v1/models/${encodeURIComponent(modelId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!attempt.ok) {
        throw new HttpStatusError(
          attempt.status,
          `OpenAI connection test failed with HTTP ${attempt.status}`,
        );
      }

      return attempt;
    }, this.#retry);
    const body = (await response.json()) as unknown;
    if (
      body === null ||
      typeof body !== "object" ||
      !("id" in body) ||
      typeof body.id !== "string"
    ) {
      throw new InvalidResponseError(
        "OpenAI returned an invalid model response",
      );
    }

    return {
      provider: "openai",
      modelId: body.id,
    };
  }
}

function validateApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized === "" || normalized.includes("\n")) {
    throw new TypeError("OpenAI API key must be a non-empty single line");
  }

  return normalized;
}
