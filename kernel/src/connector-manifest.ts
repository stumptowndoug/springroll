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

const headerNameSchema = z
  .string()
  .min(1)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "must be a valid HTTP header name");

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
]);

const credentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("oauth") }).strict(),
  z
    .object({
      kind: z.literal("api-key"),
      placeholder: z.string().min(1),
      keyCreationUrl: httpUrlSchema.optional(),
      header: headerNameSchema.optional(),
      env: z
        .string()
        .min(1)
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid environment name")
        .optional(),
    })
    .strict(),
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
    } else if (
      manifest.credential.kind === "api-key" &&
      manifest.credential.env !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["credential", "env"],
        message:
          "remote and OpenAPI credentials are injected through HTTP headers",
      });
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
