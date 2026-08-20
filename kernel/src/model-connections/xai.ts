import { createXai, type XaiProvider } from "@ai-sdk/xai";
import type { AiSdkModelPricing } from "../ai-sdk-agent-runner.ts";
import type { CredentialStore } from "../credentials.ts";
import {
  HttpStatusError,
  InvalidResponseError,
  type RetryOptions,
  withRetry,
} from "../failures.ts";
import { type FetchApi, MissingCredentialError } from "./openai.ts";

export const xaiApiKeyCreationUrl = "https://console.x.ai/home";
export const defaultXaiModelId = "grok-4.5";

export interface XaiModelConnectionOptions {
  readonly fetch?: FetchApi;
  readonly retry?: RetryOptions;
}

export interface XaiConnectionRequest {
  readonly credentialRef: string;
  readonly apiKey: string;
  readonly modelId?: string;
}

export interface XaiConnectionTestResult {
  readonly provider: "xai";
  readonly modelId: string;
  readonly pricing?: AiSdkModelPricing;
}

export interface XaiAgentRuntime {
  readonly model: ReturnType<XaiProvider["chat"]>;
  readonly pricing?: AiSdkModelPricing;
}

export class XaiModelConnection {
  readonly #fetch: FetchApi;
  readonly #retry: RetryOptions | undefined;

  constructor(
    private readonly credentials: CredentialStore,
    options: XaiModelConnectionOptions = {},
  ) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#retry = options.retry;
  }

  async connect(
    request: XaiConnectionRequest,
  ): Promise<XaiConnectionTestResult> {
    const apiKey = validateApiKey(request.apiKey);
    const modelId = request.modelId ?? defaultXaiModelId;
    const result = await this.testApiKey(apiKey, modelId);
    await this.credentials.put(request.credentialRef, apiKey);

    return result;
  }

  async test(
    credentialRef: string,
    modelId = defaultXaiModelId,
  ): Promise<XaiConnectionTestResult> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No xAI API key found for ${credentialRef}`,
      );
    }

    return this.testApiKey(apiKey, modelId);
  }

  async loadModel(
    credentialRef: string,
    modelId = defaultXaiModelId,
  ): Promise<ReturnType<XaiProvider["chat"]>> {
    return (await this.loadAgentRuntime(credentialRef, modelId)).model;
  }

  async loadImageModel(
    credentialRef: string,
    modelId: string,
  ): Promise<ReturnType<XaiProvider["image"]>> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No xAI API key found for ${credentialRef}`,
      );
    }
    return createXai({
      apiKey,
      fetch: this.#fetch as typeof globalThis.fetch,
    }).image(modelId);
  }

  async loadAgentRuntime(
    credentialRef: string,
    modelId = defaultXaiModelId,
  ): Promise<XaiAgentRuntime> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No xAI API key found for ${credentialRef}`,
      );
    }

    const provider = createXai({
      apiKey,
      fetch: this.#fetch as typeof globalThis.fetch,
    });
    const verification = await this.testApiKey(apiKey, modelId);

    return {
      // The chat API supports Springroll's host-executed tools. The xAI
      // Responses API currently only supports its server-side tools.
      model: provider.chat(modelId),
      ...(verification.pricing ? { pricing: verification.pricing } : undefined),
    };
  }

  async disconnect(credentialRef: string): Promise<void> {
    await this.credentials.delete(credentialRef);
  }

  private async testApiKey(
    apiKey: string,
    modelId: string,
  ): Promise<XaiConnectionTestResult> {
    const response = await withRetry(async () => {
      const attempt = await this.#fetch(
        `https://api.x.ai/v1/models/${encodeURIComponent(modelId)}`,
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
          `xAI connection test failed with HTTP ${attempt.status}`,
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
      throw new InvalidResponseError("xAI returned an invalid model response");
    }

    const pricing = readPricing(body);
    return {
      provider: "xai",
      modelId: body.id,
      ...(pricing ? { pricing } : undefined),
    };
  }
}

function readPricing(model: object): AiSdkModelPricing | undefined {
  if (
    !("prompt_text_token_price" in model) ||
    !("completion_text_token_price" in model) ||
    typeof model.prompt_text_token_price !== "number" ||
    typeof model.completion_text_token_price !== "number" ||
    !Number.isFinite(model.prompt_text_token_price) ||
    !Number.isFinite(model.completion_text_token_price) ||
    model.prompt_text_token_price < 0 ||
    model.completion_text_token_price < 0
  ) {
    return undefined;
  }

  // xAI reports integer USD cents per 100 million tokens.
  return {
    inputUsdPerMillionTokens: model.prompt_text_token_price / 10_000,
    outputUsdPerMillionTokens: model.completion_text_token_price / 10_000,
  };
}

function validateApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized === "" || normalized.includes("\n")) {
    throw new TypeError("xAI API key must be a non-empty single line");
  }

  return normalized;
}
