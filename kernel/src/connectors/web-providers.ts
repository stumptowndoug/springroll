import {
  redactCredentialJson,
  redactCredentialText,
} from "../credential-redaction.ts";
import type { FetchApi } from "../model-connections/openai.ts";
import type { JsonObject, JsonValue, ToolResult } from "../tools.ts";
import { focusedText } from "./web-text.ts";

export const webProviderIds = ["exa", "parallel", "firecrawl"] as const;
export type WebProviderId = (typeof webProviderIds)[number];
export type WebReaderId = WebProviderId | "direct";
export const webProviderDefinitions = {
  exa: {
    name: "Exa",
    credentialRef: "exa-web-default",
    keyCreationUrl: "https://dashboard.exa.ai/api-keys",
    description: "Search and focused source excerpts.",
  },
  parallel: {
    name: "Parallel",
    credentialRef: "parallel-web-default",
    keyCreationUrl: "https://platform.parallel.ai",
    description: "Web search and query-focused page reading.",
  },
  firecrawl: {
    name: "Firecrawl",
    credentialRef: "firecrawl-web-default",
    keyCreationUrl: "https://www.firecrawl.dev/app/api-keys",
    description: "Web search and rendered page content.",
  },
} as const;

export function isWebProviderId(value: unknown): value is WebProviderId {
  return (
    typeof value === "string" && webProviderIds.includes(value as WebProviderId)
  );
}

export function webResearchSelection(config: JsonObject): {
  searchProvider: WebProviderId;
  readerProvider: WebReaderId;
} {
  return {
    searchProvider: isWebProviderId(config.searchProvider)
      ? config.searchProvider
      : "exa",
    readerProvider:
      config.readerProvider === "direct" ||
      isWebProviderId(config.readerProvider)
        ? config.readerProvider
        : "exa",
  };
}

type AdditionalProvider = Exclude<WebProviderId, "exa">;

async function callProvider(
  provider: AdditionalProvider,
  apiKey: string,
  path: string,
  body: JsonObject,
  fetch: FetchApi,
  signal?: AbortSignal,
): Promise<JsonObject> {
  const name = webProviderDefinitions[provider].name;
  try {
    const response = await fetch(
      `${provider === "parallel" ? "https://api.parallel.ai/v1" : "https://api.firecrawl.dev/v2"}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(provider === "parallel"
            ? { "x-api-key": apiKey }
            : { authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok)
      throw new Error(`${name} request failed (HTTP ${response.status})`);
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Reflect.get(payload, "success") === false
    )
      throw new Error(`${name} returned an unsuccessful response`);
    return redactCredentialJson(payload as JsonObject, [apiKey]) as JsonObject;
  } catch (error) {
    if (signal?.aborted)
      throw signal.reason ?? new DOMException("Cancelled", "AbortError");
    const safe = new Error(
      redactCredentialText(
        error instanceof Error ? error.message : String(error),
        [apiKey],
      ),
    );
    if (error instanceof Error) safe.name = error.name;
    throw safe;
  }
}

function object(value: JsonValue | undefined): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.filter((item) => typeof item === "string").join("\n")
      : "";
}

export async function searchWebProvider(
  provider: AdditionalProvider,
  apiKey: string,
  query: string,
  fetch: FetchApi,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const payload = await callProvider(
    provider,
    apiKey,
    "/search",
    provider === "parallel"
      ? {
          search_queries: [query],
          objective: query,
          mode: "fast",
          max_chars_total: 5000,
        }
      : { query, limit: 5, sources: ["web"] },
    fetch,
    signal,
  );
  const raw =
    provider === "parallel" ? payload.results : object(payload.data)?.web;
  if (!Array.isArray(raw))
    throw new Error(
      `${webProviderDefinitions[provider].name} returned invalid search results`,
    );
  const results = raw.slice(0, 5).flatMap((value): JsonObject[] => {
    const row = object(value);
    if (!row || typeof row.url !== "string") return [];
    return [
      {
        url: row.url,
        title: text(row.title).slice(0, 500),
        summary: text(row.excerpts ?? row.description).slice(0, 1000),
        ...(typeof row.publish_date === "string"
          ? { publishedDate: row.publish_date }
          : {}),
      },
    ];
  });
  const structuredContent: JsonObject = {
    provider,
    results,
    ...(typeof payload.creditsUsed === "number"
      ? { creditsUsed: payload.creditsUsed }
      : {}),
    ...(Array.isArray(payload.usage) ? { usage: payload.usage } : {}),
  };
  return { content: [structuredContent], structuredContent };
}

export async function readWebProvider(
  provider: AdditionalProvider,
  apiKey: string,
  url: string,
  focus: string | undefined,
  maxCharacters: number,
  fetch: FetchApi,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const payload = await callProvider(
    provider,
    apiKey,
    provider === "parallel" ? "/extract" : "/scrape",
    provider === "parallel"
      ? {
          urls: [url],
          objective: focus ?? "Read the main content of this page",
          max_chars_total: maxCharacters,
        }
      : { url, formats: ["markdown"], onlyMainContent: true, maxAge: 0 },
    fetch,
    signal,
  );
  const row =
    provider === "parallel"
      ? Array.isArray(payload.results)
        ? object(payload.results[0])
        : undefined
      : object(payload.data);
  const content = row
    ? text(row.excerpts ?? row.full_content ?? row.markdown)
    : "";
  if (!content.trim())
    throw new Error(
      `${webProviderDefinitions[provider].name} could not read this page`,
    );
  const structuredContent: JsonObject = {
    provider,
    reader: provider,
    url,
    truncated: content.length > maxCharacters,
    ...(Array.isArray(payload.usage) ? { usage: payload.usage } : {}),
  };
  return {
    content: [
      `Source URL: ${url}\nReader: ${webProviderDefinitions[provider].name}\n${focus ? `Research focus: ${focus}\n` : ""}\n${focus ? focusedText(content, focus, maxCharacters) : content.slice(0, maxCharacters)}`,
    ],
    structuredContent,
  };
}

export async function verifyWebProviderCredential(
  provider: AdditionalProvider,
  apiKey: string,
  fetch: FetchApi = globalThis.fetch,
): Promise<void> {
  await searchWebProvider(
    provider,
    apiKey,
    "Springroll connection check",
    fetch,
  );
}
