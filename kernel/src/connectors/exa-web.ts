import { webSearch } from "@exalabs/ai-sdk";
import type { CredentialStore } from "../credentials.ts";
import type { FetchApi } from "../model-connections/openai.ts";
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
export const exaMcpUrl = "https://mcp.exa.ai/mcp";

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
        const apiKey = await options.credentials.get(options.credentialRef);
        if (!apiKey) {
          return callExaMcp(
            request,
            "web_search_exa",
            { query, numResults: 5 },
            context.signal,
          );
        }

        if (request !== globalThis.fetch) {
          return searchExa(request, apiKey, query, context.signal);
        }

        const search = webSearch({
          apiKey,
          type: "auto",
          numResults: 5,
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
        const apiKey = await options.credentials.get(options.credentialRef);
        if (!apiKey) {
          return callExaMcp(
            request,
            "web_fetch_exa",
            { urls: [url], maxCharacters: 12_000 },
            context.signal,
          );
        }
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
      query: "Springroll connection check",
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
      numResults: 5,
      contents: {
        text: { maxCharacters: 3_000 },
        livecrawl: "fallback",
      },
    }),
    ...(signal ? { signal } : undefined),
  });
  return toToolResult(await readExaResponse(response, "search the web"));
}

async function callExaMcp(
  request: FetchApi,
  toolName: "web_fetch_exa" | "web_search_exa",
  input: JsonObject,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const response = await request(exaMcpUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: input,
      },
    }),
    ...(signal ? { signal } : undefined),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `Free Exa search failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const body = await response.text();
  const payload = parseMcpPayload(body);
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("result" in payload) ||
    payload.result === null ||
    typeof payload.result !== "object"
  ) {
    throw new Error("Free Exa search returned an invalid MCP response");
  }
  const result = payload.result;
  if ("isError" in result && result.isError === true) {
    throw new Error(readMcpError(result));
  }
  const content =
    "content" in result && Array.isArray(result.content)
      ? result.content.map(toMcpContent)
      : [];
  const structuredContent =
    "structuredContent" in result && isUnknownObject(result.structuredContent)
      ? (toJsonValue(result.structuredContent) as JsonObject)
      : undefined;

  return {
    content,
    ...(structuredContent ? { structuredContent } : undefined),
  };
}

function parseMcpPayload(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as unknown;
  }

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    return JSON.parse(data) as unknown;
  }
  return undefined;
}

function toMcpContent(value: unknown): JsonValue {
  if (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }
  return toJsonValue(value);
}

function readMcpError(result: object): string {
  if ("content" in result && Array.isArray(result.content)) {
    const text = result.content
      .map((entry) =>
        entry !== null &&
        typeof entry === "object" &&
        "text" in entry &&
        typeof entry.text === "string"
          ? entry.text
          : undefined,
      )
      .find((entry) => entry !== undefined);
    if (text) return text;
  }
  return "Free Exa search could not complete the request";
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
    "x-exa-integration": "springroll",
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

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
