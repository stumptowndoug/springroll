import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  redactCredentialJson,
  redactCredentialText,
} from "../credential-redaction.ts";
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
  readonly now?: () => Date;
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
}

export type WebFreshness = "live" | "recent" | "any";

const directFetchTimeoutMs = 30_000;
const directFetchMaxBytes = 500_000;
const directFetchMaxRedirects = 5;

export function createExaWebToolSource(
  options: ExaWebToolSourceOptions,
): ToolSource {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const resolveHostname =
    options.resolveHostname ??
    (async (hostname: string) =>
      (await lookup(hostname, { all: true, verbatim: true })).map(
        ({ address }) => address,
      ));

  return createNativeToolSource(options.id, [
    {
      descriptor: {
        name: "search_web",
        description:
          "Search the live-crawled public web to discover sources. For current facts, include the exact host date in the query, reject pages whose own date conflicts, and fetch an authoritative result URL directly before answering.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              description: "The web search query.",
            },
            freshness: {
              type: "string",
              enum: ["live", "recent", "any"],
              description:
                "How time-sensitive the requested fact is: live for facts changing within hours, recent for news or updates, and any for stable background research. If omitted, Springroll classifies the query conservatively.",
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
        const freshness = readFreshness(input, query);
        const retrievedAt = now().toISOString();
        const effectiveQuery = datedLiveQuery(query, freshness, retrievedAt);
        const apiKey = await options.credentials.get(options.credentialRef);
        if (!apiKey) {
          return withSearchContext(
            await callExaMcp(
              request,
              "web_search_exa",
              {
                query: effectiveQuery,
                numResults: 5,
                livecrawl: "always",
              },
              context.signal,
            ),
            freshness,
            retrievedAt,
          );
        }

        return withSearchContext(
          await searchExa(request, apiKey, effectiveQuery, context.signal),
          freshness,
          retrievedAt,
        );
      },
    },
    {
      descriptor: {
        name: "fetch_public_url",
        description:
          "Fetch a public HTML, JSON, XML, or text URL directly from its origin without using a search-index cache. Use this after discovery for authoritative or current facts. Verify the source's own observation/update timestamp because retrieval time alone does not make page content current.",
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
        return fetchPublicUrlDirectly(
          request,
          url,
          resolveHostname,
          now,
          context.signal,
        );
      },
    },
  ]);
}

export async function verifyExaCredential(
  apiKey: string,
  request: FetchApi = globalThis.fetch,
): Promise<void> {
  const response = await requestExa(request, apiKey, "verify that API key", {
    method: "POST",
    headers: exaHeaders(apiKey),
    body: JSON.stringify({
      query: "Springroll connection check",
      type: "fast",
      numResults: 1,
      contents: { text: false },
    }),
  });
  await readExaResponse(response, "verify that API key", apiKey);
}

async function searchExa(
  request: FetchApi,
  apiKey: string,
  query: string,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const response = await requestExa(request, apiKey, "search the web", {
    method: "POST",
    headers: exaHeaders(apiKey),
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 5,
      contents: {
        text: { maxCharacters: 3_000 },
        maxAgeHours: 0,
        livecrawlTimeout: 12_000,
      },
    }),
    ...(signal ? { signal } : undefined),
  });
  return toToolResult(
    await readExaResponse(response, "search the web", apiKey),
  );
}

async function requestExa(
  request: FetchApi,
  apiKey: string,
  operation: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await request(`${exaApiBaseUrl}/search`, init);
  } catch (error) {
    const message = redactCredentialText(
      error instanceof Error ? error.message : String(error),
      [apiKey],
    );
    if (error instanceof Error && error.name === "AbortError") {
      const safeError = new Error(message);
      safeError.name = "AbortError";
      throw safeError;
    }
    throw new Error(`Exa could not ${operation}: ${message}`);
  }
}

function datedLiveQuery(
  query: string,
  freshness: WebFreshness,
  retrievedAt: string,
): string {
  if (freshness !== "live") return query;
  const date = retrievedAt.slice(0, 10);
  return query.includes(date) ? query : `${query} ${date}`;
}

export function classifyWebFreshness(query: string): WebFreshness {
  const normalized = query.toLowerCase();
  if (
    /\b(current(?:ly)?|now|right now|today|tonight|live|weather|temperature|forecast|score|standings|traffic|flight status|stock price|exchange rate|outage|open now)\b/.test(
      normalized,
    )
  ) {
    return "live";
  }
  if (
    /\b(latest|recent|news|yesterday|this week|new release|released|update|updated|announcement)\b/.test(
      normalized,
    )
  ) {
    return "recent";
  }
  return "any";
}

function readFreshness(input: JsonObject, query: string): WebFreshness {
  const inferred = classifyWebFreshness(query);
  const value = input.freshness;
  if (value === undefined) return inferred;
  if (value !== "live" && value !== "recent" && value !== "any") {
    throw new TypeError("freshness must be live, recent, or any");
  }
  if (inferred === "live" || value === "live") return "live";
  if (inferred === "recent" || value === "recent") return "recent";
  return "any";
}

function withSearchContext(
  result: ToolResult,
  freshness: WebFreshness,
  retrievedAt: string,
): ToolResult {
  const guidance =
    freshness === "live"
      ? "LIVE EVIDENCE POLICY: Result contents were live-crawled for the dated query, but a live crawl can still retrieve a historical page. Reject pages whose own date conflicts with the requested date, then fetch an authoritative result URL directly before making a current claim."
      : freshness === "recent"
        ? "RECENT EVIDENCE POLICY: Result contents were live-crawled. Prefer an authoritative result, fetch it directly, and verify its publication/update date before calling it latest or recent."
        : "BACKGROUND RESEARCH: Result contents were live-crawled. Fetch primary sources directly when exact details or attribution matter.";
  return {
    ...result,
    content: [
      `Search freshness: ${freshness}\nSearch retrieved at: ${retrievedAt}\n${guidance}`,
      ...result.content,
    ],
  };
}

async function fetchPublicUrlDirectly(
  request: FetchApi,
  initialUrl: string,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
  now: () => Date,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error("Public URL fetch timed out")),
    directFetchTimeoutMs,
  );

  try {
    let url = initialUrl;
    for (let redirectCount = 0; ; redirectCount += 1) {
      await assertPublicUrl(url, resolveHostname);
      const response = await request(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: {
          accept:
            "application/json, application/ld+json, text/html, text/markdown, text/plain, application/xml, text/xml;q=0.9, */*;q=0.1",
          "user-agent":
            "Springroll/0.1 (+https://github.com/dougdement/springroll)",
        },
        signal: controller.signal,
      });

      if (isRedirect(response.status)) {
        if (redirectCount >= directFetchMaxRedirects) {
          throw new Error("Public URL redirected too many times");
        }
        const location = response.headers.get("location");
        if (!location) throw new Error("Public URL redirect had no location");
        url = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) {
        throw new Error(`Public URL fetch failed (${response.status})`);
      }

      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (!isReadableContentType(contentType)) {
        throw new Error(
          `Public URL returned an unsupported content type: ${contentType ?? "unknown"}`,
        );
      }
      const body = await readBoundedResponse(response);
      const readable =
        contentType === "text/html" ? htmlToText(body.text, url) : body.text;
      const retrievedAt = now().toISOString();
      const header = [
        `Direct source URL: ${url}`,
        `Retrieved at: ${retrievedAt}`,
        `HTTP status: ${response.status}`,
        `Content-Type: ${contentType ?? "unknown"}`,
        body.truncated ? "Content truncated: yes" : "Content truncated: no",
        "Freshness note: Retrieval time proves when Springroll fetched this response, not when the source data was observed or updated. Verify the source's own timestamp before making a current claim.",
      ].join("\n");
      return {
        content: [`${header}\n\n${readable}`],
        structuredContent: {
          url,
          retrievedAt,
          status: response.status,
          contentType: contentType ?? "unknown",
          truncated: body.truncated,
        },
      };
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function assertPublicUrl(
  value: string,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ToolPolicyError("Public URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new ToolPolicyError("Public URL must not contain credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new ToolPolicyError("Public URL cannot target a local host");
  }
  const addresses = isIP(hostname)
    ? [hostname]
    : await resolveHostname(hostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicAddress(address))
  ) {
    throw new ToolPolicyError(
      "Public URL cannot target a private or reserved network",
    );
  }
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPublicAddress(normalized.slice("::ffff:".length));
    }
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }
  return false;
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function isReadableContentType(contentType: string | undefined): boolean {
  return (
    contentType === undefined ||
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/ld+json" ||
    contentType === "application/xml" ||
    contentType.endsWith("+json") ||
    contentType.endsWith("+xml")
  );
}

async function readBoundedResponse(
  response: Response,
): Promise<{ readonly text: string; readonly truncated: boolean }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > directFetchMaxBytes) {
    throw new Error("Public URL response is too large");
  }
  if (!response.body) return { text: "", truncated: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  let truncated = false;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const remaining = directFetchMaxBytes - bytes;
    if (chunk.value.byteLength > remaining) {
      text += decoder.decode(chunk.value.subarray(0, remaining), {
        stream: true,
      });
      truncated = true;
      await reader.cancel();
      break;
    }
    bytes += chunk.value.byteLength;
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return { text, truncated };
}

function htmlToText(html: string, baseUrl: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(
        /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
        (_match, _quote: string, href: string, label: string) => {
          const text = decodeHtmlEntities(label.replace(/<[^>]+>/g, " "))
            .replace(/\s+/g, " ")
            .trim();
          try {
            const resolved = new URL(decodeHtmlEntities(href), baseUrl);
            if (
              resolved.protocol !== "https:" &&
              resolved.protocol !== "http:"
            ) {
              return text;
            }
            const target = resolved.toString();
            return text && text !== target ? `${text} (${target})` : target;
          } catch {
            return text;
          }
        },
      )
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(
        /<\/(p|div|section|article|main|header|footer|aside|nav|li|tr|h[1-6])>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }
      return named[entity.toLowerCase()] ?? match;
    },
  );
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
  apiKey?: string,
): Promise<JsonValue> {
  if (!response.ok) {
    const detail = redactCredentialText((await response.text()).slice(0, 300), [
      apiKey,
    ]);
    throw new Error(
      `Exa could not ${operation} (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return redactCredentialJson(toJsonValue(await response.json()), [apiKey]);
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
