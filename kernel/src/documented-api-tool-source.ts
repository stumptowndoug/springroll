import {
  applyConnectorToolPolicy,
  type ConnectorManifest,
  parseConnectorManifest,
} from "./connector-manifest.ts";
import {
  redactCredentialJson,
  redactCredentialText,
} from "./credential-redaction.ts";
import { type CredentialStore, MissingCredentialError } from "./credentials.ts";
import {
  type JsonObject,
  type JsonValue,
  type ToolDescriptor,
  ToolPolicyError,
  type ToolResult,
  type ToolSource,
} from "./tools.ts";

export type DocumentedApiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DocumentedApiToolSourceOptions {
  readonly manifest: ConnectorManifest;
  readonly credentials: CredentialStore;
  readonly fetch?: DocumentedApiFetch;
}

export class DocumentedApiToolCallError extends Error {
  override readonly name = "DocumentedApiToolCallError";
}

export function createDocumentedApiToolSource(
  options: DocumentedApiToolSourceOptions,
): ToolSource {
  const manifest = parseConnectorManifest(options.manifest);
  if (manifest.transport.kind !== "http-api") {
    throw new TypeError(
      `Connector ${manifest.id} does not use the http-api transport`,
    );
  }
  const transport = manifest.transport;
  const request = options.fetch ?? globalThis.fetch;
  const descriptors = applyConnectorToolPolicy(
    manifest,
    transport.operations.map(
      (operation): ToolDescriptor => ({
        name: operation.name,
        description: operation.description,
        inputSchema: operation.inputSchema,
        declaredRisk: {
          effect: operation.effect,
          openWorld: true,
          idempotent: operation.method === "GET" || operation.method === "PUT",
        },
      }),
    ),
  );

  return {
    id: manifest.transport.kind,
    kind: "native",
    async open({ connection }) {
      if (connection.sourceId !== manifest.transport.kind) {
        throw new ToolPolicyError(
          `Connection ${connection.id} belongs to ${connection.sourceId}, not ${manifest.transport.kind}`,
        );
      }
      return {
        async listTools() {
          return descriptors;
        },
        async callTool(name, input, context) {
          const operation = transport.operations.find(
            (candidate) => candidate.name === name,
          );
          if (!operation) {
            throw new ToolPolicyError(
              `Unknown documented API tool: ${manifest.id}/${name}`,
            );
          }
          const secret = await resolveCredential(
            manifest,
            connection.credentialRef,
            options.credentials,
          );
          return callDocumentedApiOperation({
            manifest,
            operation,
            input,
            request,
            secret,
            signal: context.signal,
          });
        },
        async close() {},
      };
    },
  };
}

async function resolveCredential(
  manifest: ConnectorManifest,
  reference: string,
  credentials: CredentialStore,
): Promise<string | undefined> {
  if (manifest.credential.kind === "none") return undefined;
  const secret = await credentials.get(reference);
  if (!secret) {
    throw new MissingCredentialError(
      `Connector ${manifest.name} needs reconnecting before it can run`,
    );
  }
  return secret;
}

async function callDocumentedApiOperation(options: {
  readonly manifest: ConnectorManifest;
  readonly operation: Extract<
    ConnectorManifest["transport"],
    { readonly kind: "http-api" }
  >["operations"][number];
  readonly input: JsonObject;
  readonly request: DocumentedApiFetch;
  readonly secret: string | undefined;
  readonly signal: AbortSignal | undefined;
}): Promise<ToolResult> {
  const { manifest, operation, input, request, secret, signal } = options;
  if (manifest.transport.kind !== "http-api") {
    throw new TypeError("Expected a documented API connector manifest");
  }
  const url = new URL(manifest.transport.baseUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  let operationPath = operation.path;

  for (const parameter of operation.parameters ?? []) {
    const value = input[parameter.input];
    if (value === undefined) {
      if (parameter.required)
        throw new TypeError(`${parameter.input} is required`);
      continue;
    }
    if (parameter.location === "path") {
      operationPath = operationPath.replace(
        `{${parameter.name}}`,
        encodeURIComponent(stringifyPrimitive(value, parameter.input)),
      );
    } else {
      appendQuery(url.searchParams, parameter.name, value, parameter.input);
    }
  }
  if (/\{[^}]+\}/.test(operationPath)) {
    throw new TypeError(
      `Missing required path parameter for ${operation.path}`,
    );
  }
  url.pathname = `${basePath}/${operationPath.replace(/^\//, "")}`.replace(
    /\/+/g,
    "/",
  );

  const headers = new Headers({
    accept: "application/json",
    "user-agent": "Springroll/0.1 (+https://github.com/dougdement/springroll)",
  });
  if (secret && manifest.credential.kind === "api-key") {
    if (manifest.credential.query) {
      url.searchParams.set(manifest.credential.query, secret);
    } else {
      const header = manifest.credential.header ?? "authorization";
      headers.set(
        header,
        manifest.credential.header ? secret : `Bearer ${secret}`,
      );
    }
  }

  let body: string | undefined;
  if (operation.bodyInput && input[operation.bodyInput] !== undefined) {
    body = JSON.stringify(input[operation.bodyInput]);
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await request(url, {
      method: operation.method,
      headers,
      redirect: "manual",
      ...(body === undefined ? undefined : { body }),
      ...(signal ? { signal } : undefined),
    });
  } catch (error) {
    const message = redactCredentialText(
      error instanceof Error ? error.message : String(error),
      [secret],
    );
    if (error instanceof Error && error.name === "AbortError") {
      const safeError = new Error(message);
      safeError.name = "AbortError";
      throw safeError;
    }
    throw new DocumentedApiToolCallError(message);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new DocumentedApiToolCallError(
      `${manifest.name} API redirected unexpectedly (${response.status})`,
    );
  }
  const responseValue = await readBoundedResponse(response);
  const safeValue = redactCredentialJson(responseValue, [secret]);
  if (!response.ok) {
    const detail =
      typeof safeValue === "string" ? safeValue : JSON.stringify(safeValue);
    throw new DocumentedApiToolCallError(
      `${manifest.name} API call failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }
  return {
    content: safeValue === null ? [] : [safeValue],
    ...(isJsonObject(safeValue) ? { structuredContent: safeValue } : undefined),
  };
}

function appendQuery(
  search: URLSearchParams,
  name: string,
  value: JsonValue,
  inputName: string,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      search.append(name, stringifyPrimitive(item, inputName));
    }
    return;
  }
  search.append(name, stringifyPrimitive(value, inputName));
}

function stringifyPrimitive(value: JsonValue, inputName: string): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  throw new TypeError(`${inputName} must be a string, number, or boolean`);
}

async function readBoundedResponse(response: Response): Promise<JsonValue> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    throw new DocumentedApiToolCallError("API response exceeds the 1 MB limit");
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.length > 1_000_000) {
    throw new DocumentedApiToolCallError("API response exceeds the 1 MB limit");
  }
  if (!text) return null;
  const trimmed = text.trim();
  if (
    response.headers.get("content-type")?.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      return text;
    }
  }
  return text;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
