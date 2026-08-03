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
      keyCreationUrl: httpUrlSchema,
      header: headerNameSchema.optional(),
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
    transport: transportSchema,
    credential: credentialSchema,
    probe: z
      .object({
        tool: z.string().trim().min(1),
        input: z.record(z.string(), jsonValueSchema),
      })
      .strict(),
    tools: z
      .object({
        allow: z.array(z.string().trim().min(1)),
        risk: z.record(z.string().min(1), toolRiskOverrideSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const allowed = manifest.tools?.allow;
    if (allowed && new Set(allowed).size !== allowed.length) {
      context.addIssue({
        code: "custom",
        path: ["tools", "allow"],
        message: "tool allowlist entries must be unique",
      });
    }

    if (allowed && !allowed.includes(manifest.probe.tool)) {
      context.addIssue({
        code: "custom",
        path: ["probe", "tool"],
        message: "probe tool must be included in the tool allowlist",
      });
    }

    for (const [toolName, risk] of Object.entries(manifest.tools?.risk ?? {})) {
      if (allowed && !allowed.includes(toolName)) {
        context.addIssue({
          code: "custom",
          path: ["tools", "risk", toolName],
          message: "risk overrides may only target allowlisted tools",
        });
      }
      if (
        toolName === manifest.probe.tool &&
        risk.effect !== undefined &&
        risk.effect !== "read"
      ) {
        context.addIssue({
          code: "custom",
          path: ["tools", "risk", toolName, "effect"],
          message: "probe tool must be read-only",
        });
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
      return ["local", "hosted"];
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

export function assertReadOnlyProbe(
  manifest: ConnectorManifest,
  descriptors: readonly ToolDescriptor[],
): void {
  const descriptor = descriptors.find(
    (candidate) => candidate.name === manifest.probe.tool,
  );
  if (!descriptor) {
    throw new TypeError(
      `Connector probe tool is unavailable: ${manifest.id}/${manifest.probe.tool}`,
    );
  }
  if (descriptor.declaredRisk?.effect !== "read") {
    throw new TypeError(
      `Connector probe tool must declare read-only risk: ${manifest.id}/${manifest.probe.tool}`,
    );
  }
}
