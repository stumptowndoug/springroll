import { webSearch } from "@exalabs/ai-sdk";
import type { CredentialStore } from "../credentials.ts";
import {
  type FetchApi,
  MissingCredentialError,
} from "../model-connections/openai.ts";
import {
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
} from "../provider-tools.ts";
import {
  createNativeToolSource,
  type JsonObject,
  type JsonValue,
  ToolPolicyError,
  type ToolResult,
  type ToolSource,
} from "../tools.ts";

export const exaApiBaseUrl = "https://api.exa.ai";

export interface ExaWebToolSourceOptions {
  readonly id: string;
  readonly credentialRef: string;
  readonly credentials: CredentialStore;
  readonly fetch?: FetchApi;
}

export function createExaWebToolSource(
  options: ExaWebToolSourceOptions,
): ToolSource {
  const request = options.fetch ?? globalThis.fetch;

  return createNativeToolSource(options.id, [
    {
      descriptor: {
        name: "search_web",
        description:
          "Search the current public web. The agent chooses its search queries and may search more than once before answering.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              description: "The web search query.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        declaredRisk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        providerTool: {
          capability: webSearchProviderToolCapability,
          fallback: "host",
        },
      },
      async execute(input, context) {
        const query = readString(input, "query");
        const apiKey = await requireCredential(
          options.credentials,
          options.credentialRef,
        );

        if (request !== globalThis.fetch) {
          return searchExa(request, apiKey, query, context.signal);
        }

        const search = webSearch({
          apiKey,
          type: "auto",
          numResults: 8,
          contents: {
            text: { maxCharacters: 3_000 },
            livecrawl: "fallback",
          },
        });
        const execute = search.execute;
        if (!execute) {
          throw new ToolPolicyError("The Exa search tool cannot execute");
        }
        const result = await execute(
          { query },
          {
            toolCallId: `exa-search-${crypto.randomUUID()}`,
            messages: [],
            context: undefined,
            ...(context.signal ? { abortSignal: context.signal } : undefined),
          },
        );

        return toToolResult(result);
      },
    },
    {
      descriptor: {
        name: "fetch_public_url",
        description:
          "Read a specific public web page or PDF. Use this after web search when the report needs details from a result URL.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              format: "uri",
              description: "The public URL to read.",
            },
          },
          required: ["url"],
          additionalProperties: false,
        },
        declaredRisk: {
          effect: "read",
          openWorld: true,
          idempotent: true,
        },
        providerTool: {
          capability: webFetchProviderToolCapability,
          fallback: "host",
        },
      },
      async execute(input, context) {
        const url = readPublicUrl(input);
        const apiKey = await requireCredential(
          options.credentials,
          options.credentialRef,
        );
        const response = await request(`${exaApiBaseUrl}/contents`, {
          method: "POST",
          headers: exaHeaders(apiKey),
          body: JSON.stringify({
            ids: [url],
            text: { maxCharacters: 12_000 },
            livecrawl: "fallback",
          }),
          ...(context.signal ? { signal: context.signal } : undefined),
        });
        const result = await readExaResponse(response, "read that URL");
        return toToolResult(result);
      },
    },
  ]);
}

export async function verifyExaCredential(
  apiKey: string,
  request: FetchApi = globalThis.fetch,
): Promise<void> {
  const response = await request(`${exaApiBaseUrl}/search`, {
    method: "POST",
    headers: exaHeaders(apiKey),
    body: JSON.stringify({
      query: "ShrimpRoll connection check",
      type: "fast",
      numResults: 1,
      contents: { text: false },
    }),
  });
  await readExaResponse(response, "verify that API key");
}

async function searchExa(
  request: FetchApi,
  apiKey: string,
  query: string,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const response = await request(`${exaApiBaseUrl}/search`, {
    method: "POST",
    headers: exaHeaders(apiKey),
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 8,
      contents: {
        text: { maxCharacters: 3_000 },
        livecrawl: "fallback",
      },
    }),
    ...(signal ? { signal } : undefined),
  });
  return toToolResult(await readExaResponse(response, "search the web"));
}

async function requireCredential(
  credentials: CredentialStore,
  reference: string,
): Promise<string> {
  const apiKey = await credentials.get(reference);
  if (!apiKey) {
    throw new MissingCredentialError(
      "Connect portable web search in Connections before using this model for a web task",
    );
  }
  return apiKey;
}

async function readExaResponse(
  response: Response,
  operation: string,
): Promise<unknown> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `Exa could not ${operation} (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return response.json();
}

function exaHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "x-exa-integration": "shrimproll",
  };
}

function readString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function readPublicUrl(input: JsonObject): string {
  const url = new URL(readString(input, "url"));
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("url must use HTTP or HTTPS");
  }
  return url.toString();
}

function toToolResult(value: unknown): ToolResult {
  const json = toJsonValue(value);
  return {
    content: [json],
    ...(isJsonObject(json) ? { structuredContent: json } : undefined),
  };
}

function toJsonValue(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    return null;
  }
  return JSON.parse(encoded) as JsonValue;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
