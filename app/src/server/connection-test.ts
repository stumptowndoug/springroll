import type { ConnectorManifest } from "@springroll/kernel";
import { z } from "zod";
import type { ConnectionTestDto } from "../shared.ts";

export class ConnectionTestError extends Error {
  override readonly name = "ConnectionTestError";
  constructor(
    message: string,
    readonly test: ConnectionTestDto,
  ) {
    super(message);
  }
}

/** Describe the request without credentials, headers, or user data. */
export function connectionTestPlan(
  manifest: ConnectorManifest,
): Omit<ConnectionTestDto, "status" | "checkedAt"> {
  const transport = manifest.transport;
  if (transport.kind === "mcp-local" || transport.kind === "mcp-remote") {
    return { kind: "mcp-discovery" };
  }
  const operation =
    transport.kind === "http-api"
      ? transport.operations.find(
          (operation) => operation.name === manifest.probe?.tool,
        )
      : undefined;
  const endpoint = new URL(transport.baseUrl);
  endpoint.username = "";
  endpoint.password = "";
  endpoint.search = "";
  endpoint.hash = "";
  if (operation)
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${operation.path.replace(/^\//, "")}`;
  return {
    kind: "api-read",
    authentication:
      manifest.credential.kind === "none"
        ? "None"
        : manifest.credential.kind === "oauth" ||
            (manifest.credential.kind === "api-key" &&
              manifest.credential.exchange)
          ? "Authorization: Bearer (OAuth)"
          : manifest.credential.query
            ? `Query parameter: ${manifest.credential.query}`
            : manifest.credential.format === "http-basic"
              ? "Authorization: Basic"
              : manifest.credential.format === "bearer" ||
                  !manifest.credential.header
                ? "Authorization: Bearer"
                : `${manifest.credential.header}: raw key`,
    ...(manifest.probe ? { tool: manifest.probe.tool } : {}),
    ...(operation ? { method: operation.method } : {}),
    endpoint: endpoint.toString(),
  };
}

const connectionTestSchema = z.object({
  status: z.enum(["passed", "failed"]),
  kind: z.enum(["api-read", "mcp-discovery"]),
  authentication: z.string().optional(),
  tool: z.string().optional(),
  method: z.string().optional(),
  endpoint: z.string().optional(),
  checkedAt: z.string(),
});

export function readConnectionTest(
  value: unknown,
): ConnectionTestDto | undefined {
  const parsed = connectionTestSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { status, kind, checkedAt, tool, method, endpoint, authentication } =
    parsed.data;
  return {
    status,
    kind,
    checkedAt,
    ...(authentication ? { authentication } : {}),
    ...(tool ? { tool } : {}),
    ...(method ? { method } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}
