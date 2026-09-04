import { z } from "zod";
import type { ExecutionLocation } from "./contracts.ts";
import type { JsonValue, ToolDescriptor, ToolRisk } from "./tools.ts";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "must use HTTP or HTTPS");

const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", "must use HTTPS");

const headerNameSchema = z
  .string()
  .min(1)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "must be a valid HTTP header name");

const queryParameterNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/, "must be a valid query parameter name");

const documentedApiParameterSchema = z
  .object({
    input: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    location: z.enum(["path", "query"]),
    required: z.boolean().default(false),
  })
  .strict();

const documentedApiOperationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/, "must be a valid tool name"),
    description: z.string().trim().min(1).max(1_000),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine(
        (value) =>
          value.startsWith("/") && !value.includes("?") && !value.includes("#"),
        "must be an absolute API path without a query or fragment",
      ),
    inputSchema: z.record(z.string(), jsonValueSchema),
    parameters: z.array(documentedApiParameterSchema).max(50).optional(),
    fixedQuery: z
      .record(
        z.string().trim().min(1).max(100),
        z.string().trim().min(1).max(500),
      )
      .optional(),
    bodyInput: z.string().trim().min(1).max(100).optional(),
    bodyEncoding: z
      .enum(["json", "gmail-rfc822", "gmail-rfc822-draft"])
      .optional(),
    permissionSet: z.string().trim().min(1).max(80).optional(),
    effect: z.enum(["read", "write", "destructive"]),
  })
  .strict()
  .superRefine((operation, context) => {
    const properties =
      operation.inputSchema.properties !== null &&
      typeof operation.inputSchema.properties === "object" &&
      !Array.isArray(operation.inputSchema.properties)
        ? operation.inputSchema.properties
        : undefined;
    const requiredInputs = new Set(
      Array.isArray(operation.inputSchema.required)
        ? operation.inputSchema.required.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    if (
      operation.inputSchema.type !== "object" ||
      !properties ||
      operation.inputSchema.additionalProperties !== false
    ) {
      context.addIssue({
        code: "custom",
        path: ["inputSchema"],
        message:
          "documented API input schema must be a closed JSON object schema",
      });
    }
    if (operation.method === "GET" && operation.effect !== "read") {
      context.addIssue({
        code: "custom",
        path: ["effect"],
        message: "documented GET operations must be read-only",
      });
    } else if (
      operation.method === "DELETE" &&
      operation.effect !== "destructive"
    ) {
      context.addIssue({
        code: "custom",
        path: ["effect"],
        message: "documented DELETE operations must be destructive",
      });
    }
    const inputs = new Set<string>();
    const requestParameters = new Set<string>();
    for (const [index, parameter] of (operation.parameters ?? []).entries()) {
      if (inputs.has(parameter.input)) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "input"],
          message: "documented API parameter inputs must be unique",
        });
      }
      inputs.add(parameter.input);
      if (properties && !(parameter.input in properties)) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "input"],
          message: "parameter input must exist in the input schema properties",
        });
      }
      if (parameter.required && !requiredInputs.has(parameter.input)) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "required"],
          message:
            "required parameter input must be required by the input schema",
        });
      }
      const requestKey = `${parameter.location}:${parameter.name}`;
      if (requestParameters.has(requestKey)) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "name"],
          message: "documented API request parameters must be unique",
        });
      }
      requestParameters.add(requestKey);
      if (
        parameter.location === "path" &&
        !operation.path.includes(`{${parameter.name}}`)
      ) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "name"],
          message: "path parameter must appear in the documented API path",
        });
      }
    }
    if (operation.bodyInput && inputs.has(operation.bodyInput)) {
      context.addIssue({
        code: "custom",
        path: ["bodyInput"],
        message:
          "request body input must not also map to a path or query parameter",
      });
    }
    if (
      operation.bodyInput &&
      properties &&
      !(operation.bodyInput in properties)
    ) {
      context.addIssue({
        code: "custom",
        path: ["bodyInput"],
        message: "request body input must exist in the input schema properties",
      });
    }
    if (
      operation.bodyEncoding &&
      operation.bodyEncoding !== "json" &&
      operation.method !== "POST"
    ) {
      context.addIssue({
        code: "custom",
        path: ["bodyEncoding"],
        message: "Gmail RFC 822 encoding is only valid on POST operations",
      });
    }
    if (
      (operation.bodyEncoding === "gmail-rfc822" ||
        operation.bodyEncoding === "gmail-rfc822-draft") &&
      operation.effect !== "write"
    ) {
      context.addIssue({
        code: "custom",
        path: ["effect"],
        message: "Gmail send and draft operations must be write",
      });
    }
    for (const match of operation.path.matchAll(/\{([^}]+)\}/g)) {
      const name = match[1];
      if (
        !operation.parameters?.some(
          (parameter) =>
            parameter.location === "path" && parameter.name === name,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["path"],
          message: `path placeholder ${name} needs a path parameter mapping`,
        });
      }
    }
  });

const transportSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mcp-remote"),
      endpoint: httpUrlSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("mcp-local"),
      package: z
        .object({
          registry: z.literal("npm"),
          name: z
            .string()
            .trim()
            .min(1)
            .regex(
              /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/,
              "must be a valid npm package name",
            ),
          version: z
            .string()
            .trim()
            .regex(
              /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
              "must pin an exact npm package version",
            ),
        })
        .strict(),
      args: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("openapi"),
      specUrl: httpUrlSchema,
      baseUrl: httpUrlSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("http-api"),
      baseUrl: httpUrlSchema,
      operations: z
        .array(documentedApiOperationSchema)
        .min(1)
        .max(50)
        .refine(
          (operations) =>
            new Set(operations.map((operation) => operation.name)).size ===
            operations.length,
          "documented API operation names must be unique",
        ),
    })
    .strict(),
]);

const credentialExchangeSchema = z
  .object({
    kind: z.literal("google-service-account"),
    scopes: z
      .array(
        httpsUrlSchema.refine(
          (value) => new URL(value).hostname === "www.googleapis.com",
          "must be a Google OAuth scope URL",
        ),
      )
      .min(1)
      .max(6),
  })
  .strict();

const apiKeyCredentialSchema = z
  .object({
    kind: z.literal("api-key"),
    placeholder: z.string().min(1),
    format: z.literal("http-basic").optional(),
    usernamePlaceholder: z.string().min(1).max(150).optional(),
    passwordPlaceholder: z.string().min(1).max(150).optional(),
    keyCreationUrl: httpUrlSchema.optional(),
    header: headerNameSchema.optional(),
    query: queryParameterNameSchema.optional(),
    env: z
      .string()
      .min(1)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid environment name")
      .optional(),
    exchange: credentialExchangeSchema.optional(),
  })
  .strict()
  .superRefine((credential, context) => {
    if (credential.format === "http-basic") {
      if (!credential.usernamePlaceholder) {
        context.addIssue({
          code: "custom",
          path: ["usernamePlaceholder"],
          message: "HTTP Basic credentials require a username field label",
        });
      }
      if (!credential.passwordPlaceholder) {
        context.addIssue({
          code: "custom",
          path: ["passwordPlaceholder"],
          message: "HTTP Basic credentials require a password field label",
        });
      }
      if (credential.query || credential.env || credential.exchange) {
        context.addIssue({
          code: "custom",
          path: ["format"],
          message: "HTTP Basic credentials must use the Authorization header",
        });
      }
      if (
        credential.header &&
        credential.header.toLocaleLowerCase() !== "authorization"
      ) {
        context.addIssue({
          code: "custom",
          path: ["header"],
          message: "HTTP Basic credentials must use the Authorization header",
        });
      }
    } else if (
      credential.usernamePlaceholder ||
      credential.passwordPlaceholder
    ) {
      context.addIssue({
        code: "custom",
        path: ["format"],
        message: "Multiple credential fields require the http-basic format",
      });
    }
    const rails = [
      credential.header,
      credential.query,
      credential.env,
      credential.exchange,
    ].filter((value) => value !== undefined);
    if (rails.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message:
          "API keys must use exactly one host injection rail: header, query, environment, or exchange",
      });
    }
  });

const oauthScopeListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^\S+$/, "OAuth scopes must not contain whitespace"),
  )
  .min(1)
  .max(20)
  .refine(
    (scopes) => new Set(scopes).size === scopes.length,
    "OAuth scopes must be unique",
  );

const oauthPermissionSetSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/, "must be a valid permission set id"),
    label: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(200),
    scopes: oauthScopeListSchema,
    required: z.boolean().optional(),
    supersedes: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[A-Za-z0-9_-]+$/, "must be a valid permission set id"),
      )
      .max(10)
      .optional(),
  })
  .strict();

const oauthAccountIdentitySchema = z
  .object({
    endpoint: httpsUrlSchema,
    field: z.string().trim().min(1).max(80),
  })
  .strict();

const credentialSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("oauth"),
      scopes: oauthScopeListSchema.optional(),
      permissionSets: z
        .array(oauthPermissionSetSchema)
        .min(1)
        .max(10)
        .refine(
          (sets) => new Set(sets.map((set) => set.id)).size === sets.length,
          "OAuth permission set ids must be unique",
        )
        .optional(),
      accountIdentity: oauthAccountIdentitySchema.optional(),
    })
    .strict(),
  apiKeyCredentialSchema,
  z.object({ kind: z.literal("none") }).strict(),
]);

const toolRiskOverrideSchema = z
  .object({
    effect: z.enum(["read", "write", "destructive"]).optional(),
    openWorld: z.boolean().optional(),
    idempotent: z.boolean().optional(),
  })
  .strict();

export const connectorManifestSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    blurb: z.string().trim().min(1),
    logoSvg: z.string().trim().min(1).optional(),
    logoUrl: httpsUrlSchema.optional(),
    logoSource: z
      .enum(["github-registry", "github-repository", "provider"])
      .optional(),
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(30)
          .transform((tag) => tag.toLowerCase()),
      )
      .max(6)
      .optional(),
    transport: transportSchema,
    credential: credentialSchema,
    // Retained as optional legacy metadata. Connection health is established by
    // MCP initialize + tools/list, not by guessing a callable provider tool.
    probe: z
      .object({
        tool: z.string().trim().min(1),
        input: z.record(z.string(), jsonValueSchema),
      })
      .strict()
      .optional(),
    tools: z
      .object({
        allow: z.array(z.string().trim().min(1)).optional(),
        risk: z.record(z.string().min(1), toolRiskOverrideSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      (manifest.logoUrl === undefined) !==
      (manifest.logoSource === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: [manifest.logoUrl === undefined ? "logoUrl" : "logoSource"],
        message: "connector logo URL and provenance must be declared together",
      });
    }
    const allowed = manifest.tools?.allow;
    if (manifest.tags && new Set(manifest.tags).size !== manifest.tags.length) {
      context.addIssue({
        code: "custom",
        path: ["tags"],
        message: "connector tags must be unique",
      });
    }
    if (allowed && new Set(allowed).size !== allowed.length) {
      context.addIssue({
        code: "custom",
        path: ["tools", "allow"],
        message: "tool allowlist entries must be unique",
      });
    }

    for (const toolName of Object.keys(manifest.tools?.risk ?? {})) {
      if (allowed && !allowed.includes(toolName)) {
        context.addIssue({
          code: "custom",
          path: ["tools", "risk", toolName],
          message: "risk overrides may only target allowlisted tools",
        });
      }
    }

    if (manifest.credential.kind === "oauth") {
      const permissionSets = manifest.credential.permissionSets ?? [];
      const permissionSetIds = new Set(permissionSets.map((set) => set.id));
      if (
        permissionSets.length > 0 &&
        !permissionSets.some((set) => set.required)
      ) {
        context.addIssue({
          code: "custom",
          path: ["credential", "permissionSets"],
          message: "OAuth permission sets must include one required base set",
        });
      }
      for (const [index, set] of permissionSets.entries()) {
        for (const superseded of set.supersedes ?? []) {
          if (!permissionSetIds.has(superseded) || superseded === set.id) {
            context.addIssue({
              code: "custom",
              path: ["credential", "permissionSets", index, "supersedes"],
              message: "superseded permission sets must be other declared sets",
            });
          }
        }
      }
      if (manifest.transport.kind === "http-api") {
        for (const [
          index,
          operation,
        ] of manifest.transport.operations.entries()) {
          if (
            operation.permissionSet &&
            !permissionSetIds.has(operation.permissionSet)
          ) {
            context.addIssue({
              code: "custom",
              path: ["transport", "operations", index, "permissionSet"],
              message:
                "permission set must match a declared OAuth permission set",
            });
          }
        }
      }
    }

    if (manifest.transport.kind === "mcp-local") {
      if (manifest.credential.kind === "oauth") {
        context.addIssue({
          code: "custom",
          path: ["credential", "kind"],
          message:
            "local MCP packages must handle their own sign-in or use an API key",
        });
      }
      if (
        manifest.credential.kind === "api-key" &&
        manifest.credential.env === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["credential", "env"],
          message:
            "local MCP API keys require a host-injected environment name",
        });
      }
      if (
        manifest.credential.kind === "api-key" &&
        (manifest.credential.header !== undefined ||
          manifest.credential.query !== undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["credential"],
          message: "local MCP API keys must use environment injection",
        });
      }
    } else if (
      manifest.credential.kind === "api-key" &&
      manifest.credential.env !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["credential", "env"],
        message: "remote and API credentials cannot use environment injection",
      });
    }
    if (
      manifest.credential.kind === "api-key" &&
      manifest.credential.exchange !== undefined &&
      manifest.transport.kind !== "http-api" &&
      manifest.transport.kind !== "openapi"
    ) {
      context.addIssue({
        code: "custom",
        path: ["credential", "exchange"],
        message:
          "credential exchange is supported only by documented HTTP and OpenAPI connectors",
      });
    }
    if (
      manifest.credential.kind === "api-key" &&
      manifest.credential.format === "http-basic" &&
      manifest.transport.kind !== "http-api" &&
      manifest.transport.kind !== "openapi"
    ) {
      context.addIssue({
        code: "custom",
        path: ["credential", "format"],
        message:
          "HTTP Basic credentials are supported only by documented HTTP and OpenAPI connectors",
      });
    }
    if (
      manifest.credential.kind === "api-key" &&
      manifest.credential.query !== undefined &&
      manifest.transport.kind !== "http-api"
    ) {
      context.addIssue({
        code: "custom",
        path: ["credential", "query"],
        message:
          "query-parameter API keys are supported only by documented HTTP APIs",
      });
    }
    if (
      manifest.transport.kind === "http-api" &&
      manifest.credential.kind === "api-key" &&
      manifest.credential.query
    ) {
      const credentialQuery = manifest.credential.query.toLocaleLowerCase();
      for (const [
        operationIndex,
        operation,
      ] of manifest.transport.operations.entries()) {
        if (
          operation.parameters?.some(
            (parameter) =>
              parameter.location === "query" &&
              parameter.name.toLocaleLowerCase() === credentialQuery,
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["transport", "operations", operationIndex, "parameters"],
            message:
              "credential query parameters are host-injected and must not appear in model-visible operation inputs",
          });
        }
      }
    }
  });

export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;
export type ConnectorTransport = ConnectorManifest["transport"];
export type ConnectorCredential = ConnectorManifest["credential"];

export function parseConnectorManifest(value: unknown): ConnectorManifest {
  return connectorManifestSchema.parse(value);
}

export function connectorAvailableIn(
  manifest: Pick<ConnectorManifest, "transport">,
): readonly ExecutionLocation[] {
  switch (manifest.transport.kind) {
    case "mcp-remote":
    case "openapi":
    case "http-api":
      return ["local", "hosted"];
    case "mcp-local":
      return ["local"];
  }
}

export function applyConnectorToolPolicy(
  manifest: ConnectorManifest,
  descriptors: readonly ToolDescriptor[],
): readonly ToolDescriptor[] {
  const allow = manifest.tools?.allow;
  const risk = manifest.tools?.risk;

  return descriptors
    .filter(
      (descriptor) => allow === undefined || allow.includes(descriptor.name),
    )
    .map((descriptor) => {
      const override = risk?.[descriptor.name];
      if (!override) return descriptor;

      const declaredRisk: Partial<ToolRisk> = {
        ...descriptor.declaredRisk,
        ...(override.effect === undefined
          ? undefined
          : { effect: override.effect }),
        ...(override.openWorld === undefined
          ? undefined
          : { openWorld: override.openWorld }),
        ...(override.idempotent === undefined
          ? undefined
          : { idempotent: override.idempotent }),
      };
      return { ...descriptor, declaredRisk };
    });
}
