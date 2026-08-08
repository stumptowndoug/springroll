import { z } from "zod";
import type {
  ConnectionActionProposalOutcomeDto,
  IntegrationProposalOutcomeDto,
  IntegrationVariantDto,
  TaskActionProposalOutcomeDto,
  TaskProposalOutcomeDto,
  TaskToolRepairProposalOutcomeDto,
  TaskUpdateProposalOutcomeDto,
} from "../shared.ts";

export interface ChatToolPresentation {
  readonly label: string;
  readonly detail?: string;
}

export interface ChatToolValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function connectorProposalValidationIssuesFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): readonly ChatToolValidationIssue[] | undefined {
  if (
    part.type !== "tool-springroll_propose_connection" &&
    part.type !== "tool-springroll_propose_local_mcp" &&
    part.type !== "tool-springroll_propose_openapi_connection"
  ) {
    return undefined;
  }
  const output = asRecord(part.output);
  if (output?.status !== "invalid_input" || !Array.isArray(output.issues)) {
    return undefined;
  }
  const issues = output.issues.flatMap((value) => {
    const issue = asRecord(value);
    return typeof issue?.path === "string" && typeof issue.message === "string"
      ? [{ path: issue.path, message: issue.message }]
      : [];
  });
  return issues.length ? issues : undefined;
}

export interface ToolApprovalRiskPresentation {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly approveLabel: string;
  readonly className: "write" | "destructive";
}

export function toolApprovalRiskPresentation(
  effect: "write" | "destructive",
): ToolApprovalRiskPresentation {
  return effect === "destructive"
    ? {
        eyebrow: "Destructive approval required",
        title: "This action may be irreversible",
        description:
          "This connector call may delete data or cause an irreversible external change. Review the exact call before allowing it to run.",
        approveLabel: "Approve destructive action",
        className: "destructive",
      }
    : {
        eyebrow: "Write approval required",
        title: "This action changes external data",
        description:
          "This connector call can create or modify external data. Review the exact call before allowing it to run.",
        approveLabel: "Approve and run",
        className: "write",
      };
}

export function connectionResearchOutcomeFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): IntegrationProposalOutcomeDto | undefined {
  if (
    (part.type !== "tool-springroll_research_connection" &&
      part.type !== "tool-springroll_propose_connection" &&
      part.type !== "tool-springroll_propose_local_mcp" &&
      part.type !== "tool-springroll_propose_openapi_connection") ||
    part.state !== "output-available"
  ) {
    return undefined;
  }
  return parseIntegrationOutcome(part.output);
}

export function visibleConnectionResearchOutcomeFromToolPart(
  part: { readonly type: string; readonly [key: string]: unknown },
  messageParts: readonly {
    readonly type: string;
    readonly [key: string]: unknown;
  }[],
  pending: boolean,
): IntegrationProposalOutcomeDto | undefined {
  const outcome = connectionResearchOutcomeFromToolPart(part);
  if (!outcome) return undefined;
  if (outcome.status === "ready") {
    const partIndex = messageParts.lastIndexOf(part);
    const signature = JSON.stringify(outcome.proposal);
    const hasLaterDuplicate = messageParts.some((candidate, index) => {
      if (index <= partIndex) return false;
      const later = connectionResearchOutcomeFromToolPart(candidate);
      return (
        later?.status === "ready" &&
        JSON.stringify(later.proposal) === signature
      );
    });
    return hasLaterDuplicate ? undefined : outcome;
  }
  if (pending) return undefined;
  const partIndex = messageParts.lastIndexOf(part);
  const hasLaterResearchOutcome = messageParts.some(
    (candidate, index) =>
      index > partIndex && connectionResearchOutcomeFromToolPart(candidate),
  );
  return hasLaterResearchOutcome ? undefined : outcome;
}

const taskProposalSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  schedule: z.string(),
  scheduleLabel: z.string(),
  timezone: z.string(),
  connectionId: z.string(),
  connectionName: z.string(),
  toolNames: z.array(z.string()).max(100),
  tools: z
    .array(
      z
        .object({
          name: z.string(),
          description: z.string(),
          effect: z.enum(["read", "write", "destructive"]),
          approval: z.enum(["never", "before_call"]).optional(),
        })
        .transform((tool) => ({
          ...tool,
          approval:
            tool.approval ??
            (tool.effect === "read"
              ? ("never" as const)
              : ("before_call" as const)),
        })),
    )
    .max(100),
  contract: z.string(),
  executionMode: z.literal("local"),
  catchUpPolicy: z.enum(["catch_up", "skip_to_next"]),
  modelExecution: z
    .object({
      providerId: z.enum(["openrouter", "openai", "xai"]),
      modelId: z.string(),
      selectedBy: z.enum(["automatic", "default", "task"]),
      toolRoutes: z.array(
        z.object({
          capability: z.enum(["web.fetch", "web.search"]),
          profile: z.enum(["managed-auto", "native", "portable"]),
          service: z.enum(["exa", "openrouter", "openai", "xai"]),
        }),
      ),
    })
    .optional(),
});

const taskProposalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), proposal: taskProposalSchema }),
  z.object({
    status: z.literal("needs_integration"),
    title: z.string(),
    explanation: z.string(),
    missingCapability: z.string(),
    suggestedIntegration: z.string().optional(),
    supportedAlternative: z.string().optional(),
  }),
  z.object({
    status: z.literal("unsupported"),
    title: z.string(),
    explanation: z.string(),
    supportedAlternative: z.string().optional(),
  }),
]);

export function taskProposalOutcomeFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): TaskProposalOutcomeDto | undefined {
  if (
    part.type !== "tool-springroll_propose_task" ||
    part.state !== "output-available"
  ) {
    return undefined;
  }
  const parsed = taskProposalOutcomeSchema.safeParse(part.output);
  return parsed.success ? (parsed.data as TaskProposalOutcomeDto) : undefined;
}

const taskUpdateRecipeSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  schedule: z.string(),
  timezone: z.string(),
  catchUpPolicy: z.enum(["catch_up", "skip_to_next"]),
});
const taskUpdateProposalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    proposal: z.object({
      taskId: z.string(),
      expectedUpdatedAt: z.string().datetime(),
      before: taskUpdateRecipeSchema,
      after: taskUpdateRecipeSchema,
      changes: z.array(
        z.object({
          field: z.enum([
            "name",
            "prompt",
            "schedule",
            "timezone",
            "catchUpPolicy",
          ]),
          label: z.string(),
          before: z.string(),
          after: z.string(),
        }),
      ),
    }),
  }),
  z.object({
    status: z.enum(["not_found", "unchanged"]),
    title: z.string(),
    explanation: z.string(),
  }),
]);

export function taskUpdateProposalOutcomeFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): TaskUpdateProposalOutcomeDto | undefined {
  if (
    part.type !== "tool-springroll_propose_task_update" ||
    part.state !== "output-available"
  ) {
    return undefined;
  }
  const parsed = taskUpdateProposalOutcomeSchema.safeParse(part.output);
  return parsed.success
    ? (parsed.data as TaskUpdateProposalOutcomeDto)
    : undefined;
}

const taskToolRiskSchema = z.object({
  effect: z.enum(["read", "write", "destructive"]),
  openWorld: z.boolean(),
  idempotent: z.boolean(),
});
const taskToolRepairProposalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    proposal: z.object({
      taskId: z.string(),
      taskName: z.string(),
      changes: z.array(
        z.object({
          connectionId: z.string(),
          connectionName: z.string(),
          sourceId: z.string(),
          toolName: z.string(),
          description: z.string(),
          previousInputSchemaHash: z.string(),
          proposedInputSchemaHash: z.string(),
          inputSchema: z.record(z.string(), z.unknown()),
          previousRisk: taskToolRiskSchema,
          proposedRisk: taskToolRiskSchema,
        }),
      ),
    }),
  }),
  z.object({
    status: z.enum(["not_found", "not_needed", "unavailable"]),
    title: z.string(),
    explanation: z.string(),
  }),
]);

export function taskToolRepairProposalOutcomeFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): TaskToolRepairProposalOutcomeDto | undefined {
  if (
    part.type !== "tool-springroll_propose_task_tool_repair" ||
    part.state !== "output-available"
  ) {
    return undefined;
  }
  const parsed = taskToolRepairProposalOutcomeSchema.safeParse(part.output);
  return parsed.success
    ? (parsed.data as TaskToolRepairProposalOutcomeDto)
    : undefined;
}

const taskActionProposalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    proposal: z.object({
      taskId: z.string(),
      taskName: z.string(),
      action: z.enum(["run_now", "pause", "resume"]),
      expectedUpdatedAt: z.string().datetime(),
      enabled: z.boolean(),
      schedule: z.string(),
      timezone: z.string(),
      nextRunAt: z.string().datetime(),
      connectionNames: z.array(z.string()).max(100),
      tools: z
        .array(
          z
            .object({
              connectionName: z.string(),
              name: z.string(),
              effect: z.enum(["read", "write", "destructive"]),
              approval: z.enum(["never", "before_call"]).optional(),
            })
            .transform((tool) => ({
              ...tool,
              approval:
                tool.approval ??
                (tool.effect === "read"
                  ? ("never" as const)
                  : ("before_call" as const)),
            })),
        )
        .max(100),
    }),
  }),
  z.object({
    status: z.enum(["not_found", "unavailable"]),
    title: z.string(),
    explanation: z.string(),
  }),
]);

export function taskActionProposalOutcomeFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): TaskActionProposalOutcomeDto | undefined {
  if (
    part.type !== "tool-springroll_propose_task_action" ||
    part.state !== "output-available"
  ) {
    return undefined;
  }
  const parsed = taskActionProposalOutcomeSchema.safeParse(part.output);
  return parsed.success
    ? (parsed.data as TaskActionProposalOutcomeDto)
    : undefined;
}

const connectionActionProposalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    proposal: z.object({
      connectionId: z.string(),
      connectionName: z.string(),
      action: z.enum(["reconnect", "disconnect", "remove"]),
      expectedStatus: z.enum(["connected", "not_connected"]),
      credentialKind: z.enum(["oauth", "api-key", "none"]),
      credentialConfigured: z.boolean(),
      removable: z.boolean(),
      toolCount: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    status: z.enum(["not_found", "unavailable"]),
    title: z.string(),
    explanation: z.string(),
  }),
]);

export function connectionActionProposalOutcomeFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): ConnectionActionProposalOutcomeDto | undefined {
  if (
    part.type !== "tool-springroll_propose_connection_action" ||
    part.state !== "output-available"
  ) {
    return undefined;
  }
  const parsed = connectionActionProposalOutcomeSchema.safeParse(part.output);
  return parsed.success
    ? (parsed.data as ConnectionActionProposalOutcomeDto)
    : undefined;
}

export function describeChatToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): ChatToolPresentation {
  const input = asRecord(part.input);
  if (part.type === "tool-springroll_list_connections") {
    return { label: "Inspect connections" };
  }
  if (part.type === "tool-springroll_list_approvals") {
    return withDetail("Inspect approvals", detailFromInput(input));
  }
  if (part.type === "tool-springroll_get_usage") {
    return withDetail("Inspect usage", detailFromInput(input));
  }
  if (part.type === "tool-springroll_get_application_state") {
    return { label: "Inspect application state" };
  }
  if (part.type === "tool-springroll_research_connection") {
    return withDetail("Research connection", detailFromInput(input));
  }
  if (part.type === "tool-springroll_inspect_connector_source") {
    return withDetail("Inspect official source", detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_connection") {
    return withDetail(
      connectorProposalValidationIssuesFromToolPart(part)
        ? "Correct connection proposal"
        : "Verify connection",
      detailFromInput(input),
    );
  }
  if (part.type === "tool-springroll_propose_local_mcp") {
    return withDetail(
      connectorProposalValidationIssuesFromToolPart(part)
        ? "Correct local MCP proposal"
        : "Verify local MCP package",
      detailFromInput(input),
    );
  }
  if (part.type === "tool-springroll_propose_openapi_connection") {
    return withDetail(
      connectorProposalValidationIssuesFromToolPart(part)
        ? "Correct API proposal"
        : "Verify official API",
      detailFromInput(input),
    );
  }
  if (part.type === "tool-springroll_discover_openapi") {
    return withDetail("Discover official API", detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_task") {
    return withDetail("Draft recipe", detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_task_update") {
    return withDetail("Draft recipe update", detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_task_tool_repair") {
    return withDetail("Review recipe tools", detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_task_action") {
    const action =
      input?.action === "run_now"
        ? "Run recipe"
        : input?.action === "pause"
          ? "Pause recipe"
          : input?.action === "resume"
            ? "Resume recipe"
            : "Review recipe action";
    return withDetail(action, detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_connection_action") {
    const action =
      input?.action === "reconnect"
        ? "Reconnect connection"
        : input?.action === "disconnect"
          ? "Disconnect connection"
          : input?.action === "remove"
            ? "Remove connection"
            : "Review connection action";
    return withDetail(
      action,
      typeof input?.connectionId === "string"
        ? input.connectionId
        : detailFromInput(input),
    );
  }
  if (part.type === "tool-springroll_search_application_tools") {
    return withDetail("Search Springroll tools", detailFromInput(input));
  }
  if (part.type === "tool-springroll_describe_application_tools") {
    return withDetail("Inspect Springroll tools", detailFromInput(input));
  }
  if (part.type === "tool-springroll_activate_application_tools") {
    return withDetail("Activate Springroll tools", detailFromInput(input));
  }
  if (part.type === "tool-springroll_search_connection_tools") {
    return withDetail("Search connection tools", detailFromInput(input));
  }
  if (part.type === "tool-springroll_describe_connection_tools") {
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · Inspect tools`,
      detailFromInput(input),
    );
  }
  if (part.type === "tool-springroll_activate_connection_tools") {
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · Activate tools`,
      detailFromInput(input),
    );
  }
  if (part.type === "tool-springroll_call_read_connection_tool") {
    const toolInput = asRecord(input?.input);
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · ${humanize(input?.toolName) || "Read tool"}`,
      detailFromInput(toolInput),
    );
  }
  if (part.type === "tool-springroll_call_connection_tool") {
    const toolInput = asRecord(input?.input);
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · ${humanize(input?.toolName) || "Change data"}`,
      detailFromInput(toolInput),
    );
  }
  return withDetail(
    humanize(part.type.replace(/^tool-/, "")) || "Tool",
    detailFromInput(input),
  );
}

function withDetail(
  label: string,
  detail: string | undefined,
): ChatToolPresentation {
  return detail ? { label, detail } : { label };
}

function detailFromInput(input: Record<string, unknown> | undefined) {
  if (!input) return undefined;
  for (const key of [
    "intent",
    "request",
    "packageName",
    "name",
    "query",
    "url",
    "providerUrl",
    "status",
    "contextKind",
    "taskId",
    "runId",
  ] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().replace(/\s+/g, " ");
      return normalized.length <= 180
        ? normalized
        : `${normalized.slice(0, 177).trimEnd()}…`;
    }
  }
  return undefined;
}

function humanize(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/^springroll_/, "")
    .replaceAll(/[-_]+/g, " ")
    .trim();
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word.toLocaleLowerCase(),
    )
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isTrustedGithubLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [
        "avatars.githubusercontent.com",
        "opengraph.githubassets.com",
        "raw.githubusercontent.com",
      ].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function parseIntegrationOutcome(
  value: unknown,
): IntegrationProposalOutcomeDto | undefined {
  const outcome = asRecord(value);
  if (!outcome || typeof outcome.status !== "string") return undefined;
  if (outcome.status === "candidate") {
    const candidate = asRecord(outcome.candidate);
    const logo = asRecord(candidate?.logo);
    const validLogo =
      candidate?.logo === undefined ||
      (typeof logo?.url === "string" &&
        isTrustedGithubLogoUrl(logo.url) &&
        (logo.source === "github-registry" ||
          logo.source === "github-repository") &&
        (logo.kind === "preferred" ||
          logo.kind === "owner-avatar" ||
          logo.kind === "opengraph" ||
          logo.kind === "asset") &&
        (logo.format === "svg" || logo.format === "raster"));
    return typeof outcome.title === "string" &&
      typeof outcome.explanation === "string" &&
      typeof outcome.instruction === "string" &&
      validLogo &&
      candidate?.kind === "local-mcp" &&
      typeof candidate.name === "string" &&
      typeof candidate.operator === "string" &&
      typeof candidate.description === "string" &&
      typeof candidate.packageName === "string" &&
      typeof candidate.repositoryUrl === "string" &&
      typeof candidate.registryUrl === "string" &&
      typeof candidate.credentialRequired === "boolean"
      ? {
          status: "candidate",
          title: outcome.title,
          explanation: outcome.explanation,
          instruction: outcome.instruction,
          candidate: {
            kind: "local-mcp",
            name: candidate.name,
            operator: candidate.operator,
            description: candidate.description,
            packageName: candidate.packageName,
            repositoryUrl: candidate.repositoryUrl,
            registryUrl: candidate.registryUrl,
            credentialRequired: candidate.credentialRequired,
            ...(logo
              ? {
                  logo: {
                    url: logo.url as string,
                    source: logo.source as
                      | "github-registry"
                      | "github-repository",
                    kind: logo.kind as
                      | "preferred"
                      | "owner-avatar"
                      | "opengraph"
                      | "asset",
                    format: logo.format as "svg" | "raster",
                  },
                }
              : {}),
          },
        }
      : undefined;
  }
  if (outcome.status === "unavailable" || outcome.status === "not_found") {
    return typeof outcome.title === "string" &&
      typeof outcome.explanation === "string"
      ? {
          status: outcome.status,
          title: outcome.title,
          explanation: outcome.explanation,
        }
      : undefined;
  }
  if (outcome.status !== "ready") return undefined;
  const proposal = asRecord(outcome.proposal);
  if (
    !proposal ||
    typeof proposal.templateId !== "string" ||
    typeof proposal.name !== "string" ||
    typeof proposal.description !== "string" ||
    typeof proposal.operator !== "string" ||
    !Array.isArray(proposal.variants)
  ) {
    return undefined;
  }
  const variants: IntegrationVariantDto[] = [];
  for (const value of proposal.variants) {
    const variant = asRecord(value);
    const guidance = asRecord(variant?.guidance);
    const credentialKind = variant?.credentialKind;
    if (
      !variant ||
      typeof variant.id !== "string" ||
      typeof variant.label !== "string" ||
      typeof variant.recommended !== "boolean" ||
      (credentialKind !== "oauth" &&
        credentialKind !== "api-key" &&
        credentialKind !== "none") ||
      !guidance ||
      typeof guidance.summary !== "string" ||
      !Array.isArray(guidance.steps) ||
      !guidance.steps.every((step) => typeof step === "string") ||
      typeof guidance.docsUrl !== "string"
    ) {
      return undefined;
    }
    variants.push({
      id: variant.id,
      label: variant.label,
      recommended: variant.recommended,
      credentialKind,
      guidance: {
        summary: guidance.summary,
        steps: guidance.steps,
        docsUrl: guidance.docsUrl,
      },
    });
  }
  if (variants.length === 0) return undefined;
  const sources = Array.isArray(proposal.sources)
    ? proposal.sources.flatMap((value) => {
        const source = asRecord(value);
        return source &&
          typeof source.title === "string" &&
          typeof source.url === "string"
          ? [{ title: source.title, url: source.url }]
          : [];
      })
    : undefined;
  const tools: Array<{
    name: string;
    description?: string;
    effect: "read" | "write" | "destructive";
  }> = [];
  if (Array.isArray(proposal.tools)) {
    for (const value of proposal.tools) {
      const item = asRecord(value);
      const effect = item?.effect;
      if (
        item &&
        typeof item.name === "string" &&
        (effect === "read" || effect === "write" || effect === "destructive")
      ) {
        tools.push({
          name: item.name,
          ...(typeof item.description === "string"
            ? { description: item.description }
            : {}),
          effect,
        });
      }
    }
  }
  const apiValue = asRecord(proposal.api);
  const verificationValue = asRecord(apiValue?.verification);
  const api =
    apiValue &&
    typeof apiValue.specUrl === "string" &&
    typeof apiValue.baseUrl === "string" &&
    typeof apiValue.operationCount === "number"
      ? {
          specUrl: apiValue.specUrl,
          baseUrl: apiValue.baseUrl,
          operationCount: apiValue.operationCount,
          ...(verificationValue &&
          typeof verificationValue.tool === "string" &&
          typeof verificationValue.note === "string"
            ? {
                verification: {
                  tool: verificationValue.tool,
                  note: verificationValue.note,
                },
              }
            : {}),
          ...(Array.isArray(apiValue.notes) &&
          apiValue.notes.every((note) => typeof note === "string")
            ? { notes: apiValue.notes }
            : {}),
        }
      : undefined;
  return {
    status: "ready",
    proposal: {
      templateId: proposal.templateId,
      name: proposal.name,
      description: proposal.description,
      operator: proposal.operator,
      ...(proposal.trust === "curated" ||
      proposal.trust === "registry-verified" ||
      proposal.trust === "provider-verified" ||
      proposal.trust === "package-verified" ||
      proposal.trust === "openapi-verified"
        ? { trust: proposal.trust }
        : undefined),
      ...(typeof proposal.registryName === "string"
        ? { registryName: proposal.registryName }
        : undefined),
      ...(typeof proposal.registryVersion === "string"
        ? { registryVersion: proposal.registryVersion }
        : undefined),
      ...(typeof proposal.packageName === "string"
        ? { packageName: proposal.packageName }
        : undefined),
      ...(typeof proposal.packageVersion === "string"
        ? { packageVersion: proposal.packageVersion }
        : undefined),
      ...(Array.isArray(proposal.packageArgs) &&
      proposal.packageArgs.every((value) => typeof value === "string")
        ? { packageArgs: proposal.packageArgs }
        : undefined),
      ...(sources ? { sources } : undefined),
      ...(Array.isArray(proposal.tools) ? { tools } : undefined),
      ...(api ? { api } : undefined),
      variants,
    },
  };
}
