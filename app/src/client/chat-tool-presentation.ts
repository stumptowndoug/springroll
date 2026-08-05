import { z } from "zod";
import type {
  IntegrationProposalOutcomeDto,
  IntegrationVariantDto,
  TaskProposalOutcomeDto,
} from "../shared.ts";

export interface ChatToolPresentation {
  readonly label: string;
  readonly detail?: string;
}

export function connectionResearchOutcomeFromToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): IntegrationProposalOutcomeDto | undefined {
  if (
    (part.type !== "tool-springroll_research_connection" &&
      part.type !== "tool-springroll_propose_local_mcp") ||
    part.state !== "output-available"
  ) {
    return undefined;
  }
  return parseIntegrationOutcome(part.output);
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
      z.object({
        name: z.string(),
        description: z.string(),
        effect: z.enum(["read", "write", "destructive"]),
      }),
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

export function describeChatToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): ChatToolPresentation {
  const input = asRecord(part.input);
  if (part.type === "tool-springroll_list_connections") {
    return { label: "Inspect connections" };
  }
  if (part.type === "tool-springroll_research_connection") {
    return withDetail("Research connection", detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_local_mcp") {
    return withDetail("Verify local MCP package", detailFromInput(input));
  }
  if (part.type === "tool-springroll_propose_task") {
    return withDetail("Draft recipe", detailFromInput(input));
  }
  if (part.type === "tool-springroll_describe_connection_tools") {
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · Inspect tools`,
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

function parseIntegrationOutcome(
  value: unknown,
): IntegrationProposalOutcomeDto | undefined {
  const outcome = asRecord(value);
  if (!outcome || typeof outcome.status !== "string") return undefined;
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
        tools.push({ name: item.name, effect });
      }
    }
  }
  return {
    status: "ready",
    proposal: {
      templateId: proposal.templateId,
      name: proposal.name,
      description: proposal.description,
      operator: proposal.operator,
      ...(proposal.trust === "curated" ||
      proposal.trust === "registry-verified" ||
      proposal.trust === "package-verified"
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
      ...(sources ? { sources } : undefined),
      ...(Array.isArray(proposal.tools) ? { tools } : undefined),
      variants,
    },
  };
}
