import { createProviderDefinedToolFactory } from "@ai-sdk/provider-utils";
import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import { jsonSchema } from "ai";
import type { AiSdkProviderUsage } from "../ai-sdk-agent-runner.ts";
import type { CredentialStore } from "../credentials.ts";
import {
  HttpStatusError,
  InvalidResponseError,
  type RetryOptions,
  withRetry,
} from "../failures.ts";
import {
  type ProviderToolBindings,
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
} from "../provider-tools.ts";
import { type FetchApi, MissingCredentialError } from "./openai.ts";

export const openRouterApiKeyCreationUrl =
  "https://openrouter.ai/settings/keys";
export const defaultOpenRouterModelId = "openai/gpt-5.4-mini";
export const defaultOpenRouterModelPricing = {
  inputUsdPerMillionTokens: 0.75,
  outputUsdPerMillionTokens: 4.5,
} as const;
const openRouterWebFetch = createProviderDefinedToolFactory<
  {
    readonly url?: string;
    readonly title?: string;
    readonly content?: string;
    readonly status?: string;
  },
  Record<string, never>
>({
  id: "openrouter.web_fetch",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      url: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
      status: { type: "string" },
    },
    additionalProperties: true,
  }),
});

export interface OpenRouterAgentRuntime {
  readonly model: ReturnType<OpenRouterProvider["chat"]>;
  readonly providerTools: ProviderToolBindings;
  readonly providerUsage: {
    read(): AiSdkProviderUsage;
  };
}

export interface OpenRouterModelConnectionOptions {
  readonly fetch?: FetchApi;
  readonly retry?: RetryOptions;
}

export interface OpenRouterAgentRuntimeOptions {
  readonly maxToolCallsPerResponse?: number;
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
    return (await this.loadAgentRuntime(credentialRef, modelId)).model;
  }

  async loadAgentRuntime(
    credentialRef: string,
    modelId = defaultOpenRouterModelId,
    options: OpenRouterAgentRuntimeOptions = {},
  ): Promise<OpenRouterAgentRuntime> {
    const apiKey = await this.credentials.get(credentialRef);
    if (!apiKey) {
      throw new MissingCredentialError(
        `No OpenRouter API key found for ${credentialRef}`,
      );
    }

    const usage = new OpenRouterProviderUsage();
    const maxToolCallsPerResponse =
      options.maxToolCallsPerResponse === undefined
        ? 5
        : validatedMaxToolCallsPerResponse(options.maxToolCallsPerResponse);
    const provider = createOpenRouter({
      apiKey,
      appName: "Springroll",
      compatibility: "strict",
      fetch: createUsageTrackingFetch(this.#fetch, usage),
    });

    return {
      model: provider.chat(modelId, {
        usage: {
          include: true,
        },
        extraBody: {
          max_tool_calls: maxToolCallsPerResponse,
        },
      }),
      providerTools: {
        [webSearchProviderToolCapability]: {
          profile: "managed-auto",
          tool: provider.tools.webSearch({ engine: "auto" }),
        },
        [webFetchProviderToolCapability]: {
          profile: "managed-auto",
          tool: openRouterWebFetch({}),
        },
      },
      providerUsage: usage,
    };
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

function validatedMaxToolCallsPerResponse(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError(
      "maxToolCallsPerResponse must be an integer from 1 to 5",
    );
  }
  return value;
}

function validateApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized === "" || normalized.includes("\n")) {
    throw new TypeError("OpenRouter API key must be a non-empty single line");
  }

  return normalized;
}

class OpenRouterProviderUsage {
  #webSearchRequests = 0;

  async record(response: Response): Promise<void> {
    if (!response.headers.get("content-type")?.includes("application/json")) {
      return;
    }
    const body = (await response
      .clone()
      .json()
      .catch(() => undefined)) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return;
    }
    const responseUsage = (body as { readonly usage?: unknown }).usage;
    if (
      !responseUsage ||
      typeof responseUsage !== "object" ||
      Array.isArray(responseUsage)
    ) {
      return;
    }
    const serverToolUse = (
      responseUsage as { readonly server_tool_use?: unknown }
    ).server_tool_use;
    if (
      !serverToolUse ||
      typeof serverToolUse !== "object" ||
      Array.isArray(serverToolUse)
    ) {
      return;
    }
    const count = (serverToolUse as { readonly web_search_requests?: unknown })
      .web_search_requests;
    if (typeof count === "number" && Number.isInteger(count) && count > 0) {
      this.#webSearchRequests += count;
    }
  }

  read(): AiSdkProviderUsage {
    return this.#webSearchRequests > 0
      ? { webSearchRequests: this.#webSearchRequests }
      : {};
  }
}

function createUsageTrackingFetch(
  fetch: FetchApi,
  usage: OpenRouterProviderUsage,
): typeof globalThis.fetch {
  return Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const response = await fetch(input, init);
      await usage.record(response);
      return response;
    },
    { preconnect: globalThis.fetch.preconnect },
  );
}
