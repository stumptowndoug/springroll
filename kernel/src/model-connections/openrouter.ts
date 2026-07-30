import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import type { CredentialStore } from "../credentials.ts";
import {
  HttpStatusError,
  InvalidResponseError,
  type RetryOptions,
  withRetry,
} from "../failures.ts";
import { type FetchApi, MissingCredentialError } from "./openai.ts";

export const openRouterApiKeyCreationUrl =
  "https://openrouter.ai/settings/keys";
export const defaultOpenRouterModelId = "openai/gpt-5.4-mini";
export const defaultOpenRouterModelPricing = {
  inputUsdPerMillionTokens: 0.75,
  outputUsdPerMillionTokens: 4.5,
} as const;

export interface OpenRouterModelConnectionOptions {
  readonly fetch?: FetchApi;
  readonly retry?: RetryOptions;
}

export interface OpenRouterConnectionRequest {
  readonly credentialRef: string;
  readonly apiKey: string;
  readonly modelId?: string;
}

export interface OpenRouterConnectionTestResult {
  readonly provider: "openrouter";
  readonly modelId: string;
}

export class OpenRouterModelConnection {
  readonly #fetch: FetchApi;
  readonly #retry: RetryOptions | undefined;

  constructor(
    private readonly credentials: CredentialStore,
    options: OpenRouterModelConnectionOptions = {},
  ) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#retry = options.retry;
  }

  async connect(
    request: OpenRouterConnectionRequest,
  ): Promise<OpenRouterConnectionTestResult> {
    const apiKey = validateApiKey(request.apiKey);
    const modelId = request.modelId ?? defaultOpenRouterModelId;
    const result = await this.testApiKey(apiKey, modelId);
    await this.credentials.put(request.credentialRef, apiKey);

    return result;
  }

  async test(
    credentialRef: string,
    modelId = defaultOpenRouterModelId,
  ): Promise<OpenRouterConnectionTestResult> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No OpenRouter API key found for ${credentialRef}`,
      );
    }

    return this.testApiKey(apiKey, modelId);
  }

  async loadModel(
    credentialRef: string,
    modelId = defaultOpenRouterModelId,
  ): Promise<ReturnType<OpenRouterProvider["chat"]>> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No OpenRouter API key found for ${credentialRef}`,
      );
    }

    return createOpenRouter({
      apiKey,
      appName: "Shrimp Roll",
      compatibility: "strict",
    }).chat(modelId, {
      usage: {
        include: true,
      },
    });
  }

  async disconnect(credentialRef: string): Promise<void> {
    await this.credentials.delete(credentialRef);
  }

  private async testApiKey(
    apiKey: string,
    modelId: string,
  ): Promise<OpenRouterConnectionTestResult> {
    const response = await withRetry(async () => {
      const attempt = await this.#fetch("https://openrouter.ai/api/v1/key", {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!attempt.ok) {
        throw new HttpStatusError(
          attempt.status,
          `OpenRouter connection test failed with HTTP ${attempt.status}`,
        );
      }

      return attempt;
    }, this.#retry);
    const body = (await response.json()) as unknown;
    if (
      body === null ||
      typeof body !== "object" ||
      !("data" in body) ||
      body.data === null ||
      typeof body.data !== "object"
    ) {
      throw new InvalidResponseError(
        "OpenRouter returned an invalid key response",
      );
    }

    return {
      provider: "openrouter",
      modelId,
    };
  }
}

function validateApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized === "" || normalized.includes("\n")) {
    throw new TypeError("OpenRouter API key must be a non-empty single line");
  }

  return normalized;
}
