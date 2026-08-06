import {
  applyConnectorToolPolicy,
  type ConnectorManifest,
  parseConnectorManifest,
} from "./connector-manifest.ts";
import {
  redactCredentialJson,
  redactCredentialText,
} from "./credential-redaction.ts";
import type { CredentialStore } from "./credentials.ts";
import {
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type ToolDescriptor,
  ToolPolicyError,
  type ToolResult,
  type ToolRisk,
  type ToolSource,
} from "./tools.ts";

export type OpenApiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenApiToolSourceOptions {
  readonly manifest: ConnectorManifest;
  readonly credentials: CredentialStore;
  readonly fetch?: OpenApiFetch;
}

interface OpenApiOperation {
  readonly descriptor: ToolDescriptor;
  readonly method: string;
  readonly path: string;
  readonly parameters: readonly OpenApiParameter[];
  readonly hasBody: boolean;
}

interface OpenApiParameter {
  readonly name: string;
  readonly location: "path" | "query" | "header" | "cookie";
  readonly required: boolean;
}

const operationMethods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

export class OpenApiToolCallError extends Error {
  override readonly name = "OpenApiToolCallError";
}

export function createOpenApiToolSource(
  options: OpenApiToolSourceOptions,
): ToolSource {
  const manifest = parseConnectorManifest(options.manifest);
  if (manifest.transport.kind !== "openapi") {
    throw new TypeError(
      `Connector ${manifest.id} does not use the openapi transport`,
    );
  }
  const transport = manifest.transport;

  const request = options.fetch ?? globalThis.fetch;
  let operationsPromise: Promise<readonly OpenApiOperation[]> | undefined;

  const loadOperations = async (): Promise<readonly OpenApiOperation[]> => {
    operationsPromise ??= fetchOpenApiDocument(transport.specUrl, request)
      .then((document) => normalizeOpenApiOperations(document, manifest))
      .catch((error: unknown) => {
        operationsPromise = undefined;
        throw error;
      });
    return operationsPromise;
  };

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
          return (await loadOperations()).map(
            (operation) => operation.descriptor,
          );
        },
        async callTool(name, input, context) {
          const operation = (await loadOperations()).find(
            (candidate) => candidate.descriptor.name === name,
          );
          if (!operation) {
            throw new ToolPolicyError(
              `Unknown OpenAPI tool: ${manifest.id}/${name}`,
            );
          }

          const secret = await resolveCredential(
            manifest,
            connection.credentialRef,
            options.credentials,
          );
          return callOpenApiOperation({
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

export function normalizeOpenApiTools(
  document: unknown,
  manifestValue: ConnectorManifest,
): readonly ToolDescriptor[] {
  const manifest = parseConnectorManifest(manifestValue);
  if (manifest.transport.kind !== "openapi") {
    throw new TypeError(
      `Connector ${manifest.id} does not use the openapi transport`,
    );
  }
  return normalizeOpenApiOperations(document, manifest).map(
    (operation) => operation.descriptor,
  );
}

export function toolRiskForOpenApiMethod(method: string): ToolRisk {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
    case "TRACE":
      return { effect: "read", openWorld: true, idempotent: true };
    case "DELETE":
      return { effect: "destructive", openWorld: true, idempotent: true };
    case "PUT":
      return { effect: "write", openWorld: true, idempotent: true };
    case "POST":
    case "PATCH":
      return { effect: "write", openWorld: true, idempotent: false };
    default:
      throw new TypeError(`Unsupported OpenAPI method: ${method}`);
  }
}

async function fetchOpenApiDocument(
  specUrl: string,
  request: OpenApiFetch,
): Promise<unknown> {
  const response = await request(specUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 300);
    throw new Error(
      `Could not fetch OpenAPI spec (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new TypeError("OpenAPI spec must be valid JSON");
  }
}

function normalizeOpenApiOperations(
  document: unknown,
  manifest: ConnectorManifest,
): readonly OpenApiOperation[] {
  const root = readObject(document, "OpenAPI document");
  if (typeof root.openapi !== "string" || !root.openapi.startsWith("3.")) {
    throw new TypeError("OpenAPI document must use version 3.x");
  }
  const paths = readObject(root.paths, "OpenAPI paths");
  const operations: OpenApiOperation[] = [];
  const names = new Set<string>();
  const credentialHeader =
    manifest.credential.kind === "api-key"
      ? (manifest.credential.header ?? "authorization").toLowerCase()
      : manifest.credential.kind === "oauth"
        ? "authorization"
        : undefined;

  for (const [path, pathValue] of Object.entries(paths)) {
    const pathItem = resolveObjectReference(
      pathValue,
      root,
      `OpenAPI path ${path}`,
    );
    const pathParameters = readParameters(pathItem.parameters, root);

    for (const method of operationMethods) {
      const operationValue = pathItem[method];
      if (operationValue === undefined) continue;
      const operation = resolveObjectReference(
        operationValue,
        root,
        `${method.toUpperCase()} ${path}`,
      );
      const name = operationName(operation.operationId, method, path);
      if (names.has(name)) {
        throw new TypeError(`Duplicate OpenAPI tool name: ${name}`);
      }
      names.add(name);

      const parameters = mergeParameters(
        pathParameters,
        readParameters(operation.parameters, root),
      ).filter(
        (parameter) =>
          !(
            credentialHeader &&
            parameter.location === "header" &&
            parameter.name.toLowerCase() === credentialHeader
          ),
      );
      const requestBody = readRequestBody(operation.requestBody, root);
      const inputSchema = inputSchemaFor(parameters, requestBody);
      const outputSchema = responseSchema(operation.responses, root);
      const descriptor: ToolDescriptor = {
        name,
        description: operationDescription(operation, method, path),
        inputSchema,
        ...(outputSchema ? { outputSchema } : undefined),
        declaredRisk: toolRiskForOpenApiMethod(method),
      };

      operations.push({
        descriptor,
        method: method.toUpperCase(),
        path,
        parameters: parameters.map((parameter) => ({
          name: parameter.name,
          location: parameter.location,
          required: parameter.required,
        })),
        hasBody: requestBody !== undefined,
      });
    }
  }

  const descriptors = applyConnectorToolPolicy(
    manifest,
    operations.map((operation) => operation.descriptor),
  );
  const allowedNames = new Set(
    descriptors.map((descriptor) => descriptor.name),
  );
  const descriptorsByName = new Map(
    descriptors.map((descriptor) => [descriptor.name, descriptor]),
  );

  return operations
    .filter((operation) => allowedNames.has(operation.descriptor.name))
    .map((operation) => ({
      ...operation,
      descriptor:
        descriptorsByName.get(operation.descriptor.name) ??
        operation.descriptor,
    }));
}

interface NormalizedParameter extends OpenApiParameter {
  readonly schema: JsonSchema;
  readonly description?: string;
}

interface NormalizedRequestBody {
  readonly required: boolean;
  readonly schema: JsonSchema;
  readonly description?: string;
}

function readParameters(
  value: unknown,
  root: Record<string, unknown>,
): readonly NormalizedParameter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("OpenAPI parameters must be an array");
  }

  return value.map((entry) => {
    const parameter = resolveObjectReference(entry, root, "OpenAPI parameter");
    const name = readNonEmptyString(parameter.name, "OpenAPI parameter name");
    const location = parameter.in;
    if (
      location !== "path" &&
      location !== "query" &&
      location !== "header" &&
      location !== "cookie"
    ) {
      throw new TypeError(
        `Unsupported OpenAPI parameter location: ${location}`,
      );
    }
    const schema = toJsonObject(
      resolveSchemaReference(parameter.schema ?? {}, root),
      `OpenAPI parameter schema for ${name}`,
    );
    return {
      name,
      location,
      required: location === "path" || parameter.required === true,
      schema,
      ...(typeof parameter.description === "string"
        ? { description: parameter.description }
        : undefined),
    };
  });
}

function mergeParameters(
  inherited: readonly NormalizedParameter[],
  operation: readonly NormalizedParameter[],
): readonly NormalizedParameter[] {
  const merged = new Map(
    inherited.map((parameter) => [
      `${parameter.location}:${parameter.name}`,
      parameter,
    ]),
  );
  for (const parameter of operation) {
    merged.set(`${parameter.location}:${parameter.name}`, parameter);
  }

  const names = new Set<string>();
  for (const parameter of merged.values()) {
    if (names.has(parameter.name)) {
      throw new TypeError(
        `OpenAPI parameters named ${parameter.name} collide across locations`,
      );
    }
    names.add(parameter.name);
  }
  return [...merged.values()];
}

function readRequestBody(
  value: unknown,
  root: Record<string, unknown>,
): NormalizedRequestBody | undefined {
  if (value === undefined) return undefined;
  const requestBody = resolveObjectReference(
    value,
    root,
    "OpenAPI request body",
  );
  const content = readObject(
    requestBody.content,
    "OpenAPI request body content",
  );
  const mediaType = selectJsonMediaType(content);
  if (!mediaType) {
    throw new TypeError(
      "OpenAPI request bodies must provide a JSON media type",
    );
  }
  const media = readObject(
    content[mediaType],
    "OpenAPI request body media type",
  );
  return {
    required: requestBody.required === true,
    schema: toJsonObject(
      resolveSchemaReference(media.schema ?? {}, root),
      "OpenAPI request body schema",
    ),
    ...(typeof requestBody.description === "string"
      ? { description: requestBody.description }
      : undefined),
  };
}

function inputSchemaFor(
  parameters: readonly NormalizedParameter[],
  requestBody: NormalizedRequestBody | undefined,
): JsonSchema {
  const properties: Record<string, JsonValue> = {};
  const required: string[] = [];
  for (const parameter of parameters) {
    properties[parameter.name] = {
      ...parameter.schema,
      ...(parameter.description
        ? { description: parameter.description }
        : undefined),
    };
    if (parameter.required) required.push(parameter.name);
  }
  if (requestBody) {
    if (properties.body !== undefined) {
      throw new TypeError(
        "OpenAPI parameter name body conflicts with request body",
      );
    }
    properties.body = {
      ...requestBody.schema,
      ...(requestBody.description
        ? { description: requestBody.description }
        : undefined),
    };
    if (requestBody.required) required.push("body");
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : undefined),
    additionalProperties: false,
  };
}

function responseSchema(
  value: unknown,
  root: Record<string, unknown>,
): JsonSchema | undefined {
  if (value === undefined) return undefined;
  const responses = readObject(value, "OpenAPI responses");
  const responseEntry = Object.entries(responses).find(([status]) =>
    /^(2\d\d|2XX)$/i.test(status),
  );
  if (!responseEntry) return undefined;
  const response = resolveObjectReference(
    responseEntry[1],
    root,
    `OpenAPI response ${responseEntry[0]}`,
  );
  if (response.content === undefined) return undefined;
  const content = readObject(response.content, "OpenAPI response content");
  const mediaType = selectJsonMediaType(content);
  if (!mediaType) return undefined;
  const media = readObject(content[mediaType], "OpenAPI response media type");
  if (media.schema === undefined) return undefined;
  return toJsonObject(
    resolveSchemaReference(media.schema, root),
    "OpenAPI response schema",
  );
}

async function resolveCredential(
  manifest: ConnectorManifest,
  reference: string,
  credentials: CredentialStore,
): Promise<string | undefined> {
  if (manifest.credential.kind === "none") return undefined;
  const secret = await credentials.get(reference);
  if (!secret) {
    throw new ToolPolicyError(
      `Connector ${manifest.name} needs reconnecting before it can run`,
    );
  }
  return secret;
}

async function callOpenApiOperation(options: {
  readonly manifest: ConnectorManifest;
  readonly operation: OpenApiOperation;
  readonly input: JsonObject;
  readonly request: OpenApiFetch;
  readonly secret: string | undefined;
  readonly signal: AbortSignal | undefined;
}): Promise<ToolResult> {
  const { manifest, operation, input, request, secret, signal } = options;
  if (manifest.transport.kind !== "openapi") {
    throw new TypeError("Expected an OpenAPI connector manifest");
  }

  let path = operation.path;
  const url = new URL(manifest.transport.baseUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  const headers = new Headers({ accept: "application/json" });
  const cookies: string[] = [];

  for (const parameter of operation.parameters) {
    const value = input[parameter.name];
    if (value === undefined) {
      if (parameter.required) {
        throw new TypeError(`${parameter.name} is required`);
      }
      continue;
    }
    switch (parameter.location) {
      case "path":
        path = path.replace(
          `{${parameter.name}}`,
          encodeURIComponent(stringifyParameter(value)),
        );
        break;
      case "query":
        appendQuery(url.searchParams, parameter.name, value);
        break;
      case "header":
        headers.set(parameter.name, stringifyParameter(value));
        break;
      case "cookie":
        cookies.push(
          `${encodeURIComponent(parameter.name)}=${encodeURIComponent(stringifyParameter(value))}`,
        );
        break;
    }
  }

  if (/\{[^}]+\}/.test(path)) {
    throw new TypeError(
      `Missing required path parameter for ${operation.path}`,
    );
  }
  url.pathname = `${basePath}/${path.replace(/^\//, "")}`.replace(/\/+/g, "/");
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));

  let body: string | undefined;
  if (operation.hasBody && input.body !== undefined) {
    body = JSON.stringify(input.body);
    headers.set("content-type", "application/json");
  }

  if (secret) {
    if (manifest.credential.kind === "api-key") {
      const header = manifest.credential.header ?? "authorization";
      headers.set(
        header,
        manifest.credential.header ? secret : `Bearer ${secret}`,
      );
    } else if (manifest.credential.kind === "oauth") {
      headers.set("authorization", `Bearer ${secret}`);
    }
  }

  let response: Response;
  try {
    response = await request(url, {
      method: operation.method,
      headers,
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
    throw new OpenApiToolCallError(message);
  }
  const responseValue = await readResponseValue(response);
  const safeValue = redactCredentialJson(responseValue, [secret]);
  if (!response.ok) {
    const detail =
      typeof safeValue === "string" ? safeValue : JSON.stringify(safeValue);
    throw new OpenApiToolCallError(
      `${manifest.name} API call failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }

  return {
    content: safeValue === null ? [] : [safeValue],
    ...(isJsonObject(safeValue) ? { structuredContent: safeValue } : undefined),
  };
}

async function readResponseValue(response: Response): Promise<JsonValue> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (text === "") return null;
  const contentType = response.headers.get("content-type") ?? "";
  const trimmed = text.trim();
  if (
    contentType.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    try {
      return toJsonValue(JSON.parse(text));
    } catch {
      return text;
    }
  }
  return text;
}

function operationName(
  operationId: unknown,
  method: string,
  path: string,
): string {
  const source =
    typeof operationId === "string" && operationId.trim() !== ""
      ? operationId
      : `${method}_${path}`;
  const normalized = source
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "") {
    throw new TypeError(`Could not derive a tool name for ${method} ${path}`);
  }
  return normalized;
}

function operationDescription(
  operation: Record<string, unknown>,
  method: string,
  path: string,
): string {
  if (typeof operation.description === "string" && operation.description) {
    return operation.description;
  }
  if (typeof operation.summary === "string" && operation.summary) {
    return operation.summary;
  }
  return `${method.toUpperCase()} ${path}`;
}

function selectJsonMediaType(
  content: Record<string, unknown>,
): string | undefined {
  return Object.keys(content).find(
    (mediaType) =>
      mediaType.toLowerCase() === "application/json" ||
      mediaType.toLowerCase().endsWith("+json"),
  );
}

function resolveObjectReference(
  value: unknown,
  root: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const object = readObject(value, label);
  if (typeof object.$ref !== "string") return object;
  return readObject(resolvePointer(object.$ref, root), label);
}

function resolveSchemaReference(
  value: unknown,
  root: Record<string, unknown>,
): unknown {
  const object = readObject(value, "OpenAPI schema");
  if (typeof object.$ref !== "string") return object;
  return resolvePointer(object.$ref, root);
}

function resolvePointer(
  reference: string,
  root: Record<string, unknown>,
): unknown {
  if (!reference.startsWith("#/")) {
    throw new TypeError(
      `Only local OpenAPI references are supported: ${reference}`,
    );
  }
  let current: unknown = root;
  for (const encodedPart of reference.slice(2).split("/")) {
    const part = encodedPart.replace(/~1/g, "/").replace(/~0/g, "~");
    const object = readObject(current, `OpenAPI reference ${reference}`);
    current = object[part];
  }
  if (current === undefined) {
    throw new TypeError(`OpenAPI reference does not exist: ${reference}`);
  }
  return current;
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function toJsonObject(value: unknown, label: string): JsonObject {
  const json = toJsonValue(value);
  if (!isJsonObject(json)) throw new TypeError(`${label} must be an object`);
  return json;
}

function toJsonValue(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return null;
  return JSON.parse(encoded) as JsonValue;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyParameter(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function appendQuery(
  search: URLSearchParams,
  name: string,
  value: JsonValue,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) search.append(name, stringifyParameter(entry));
    return;
  }
  search.set(name, stringifyParameter(value));
}
