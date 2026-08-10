import type {
  IntegrationProposalOutcomeDto,
  IntegrationVariantDto,
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
    part.type !== "tool-propose_connection" &&
    part.type !== "tool-propose_local_mcp" &&
    part.type !== "tool-propose_openapi_connection"
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
    (part.type !== "tool-research_connection" &&
      part.type !== "tool-propose_connection" &&
      part.type !== "tool-propose_local_mcp" &&
      part.type !== "tool-propose_openapi_connection") ||
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

export function describeChatToolPart(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): ChatToolPresentation {
  const input = asRecord(part.input);
  if (part.type === "tool-list_connections") {
    return { label: "Inspect connections" };
  }
  if (part.type === "tool-list_approvals") {
    return withDetail("Inspect approvals", detailFromInput(input));
  }
  if (part.type === "tool-get_usage") {
    return withDetail("Inspect usage", detailFromInput(input));
  }
  if (part.type === "tool-get_application_state") {
    return { label: "Inspect application state" };
  }
  if (part.type === "tool-research_connection") {
    return withDetail("Research connection", detailFromInput(input));
  }
  if (part.type === "tool-inspect_connector_source") {
    return withDetail("Inspect official source", detailFromInput(input));
  }
  if (part.type === "tool-propose_connection") {
    return withDetail(
      connectorProposalValidationIssuesFromToolPart(part)
        ? "Correct connection proposal"
        : "Verify connection",
      detailFromInput(input),
    );
  }
  if (part.type === "tool-propose_local_mcp") {
    return withDetail(
      connectorProposalValidationIssuesFromToolPart(part)
        ? "Correct local MCP proposal"
        : "Verify local MCP package",
      detailFromInput(input),
    );
  }
  if (part.type === "tool-propose_openapi_connection") {
    return withDetail(
      connectorProposalValidationIssuesFromToolPart(part)
        ? "Correct API proposal"
        : "Verify official API",
      detailFromInput(input),
    );
  }
  if (part.type === "tool-discover_openapi") {
    return withDetail("Discover official API", detailFromInput(input));
  }
  if (part.type === "tool-create_task") {
    return withDetail("Create recipe", detailFromInput(input));
  }
  if (part.type === "tool-update_task") {
    return withDetail("Update recipe", detailFromInput(input));
  }
  if (part.type === "tool-repair_task_tools") {
    return withDetail("Repair recipe tools", detailFromInput(input));
  }
  if (part.type === "tool-run_task_now") {
    return withDetail("Run recipe", detailFromInput(input));
  }
  if (part.type === "tool-pause_task") {
    return withDetail("Pause recipe", detailFromInput(input));
  }
  if (part.type === "tool-resume_task") {
    return withDetail("Resume recipe", detailFromInput(input));
  }
  if (part.type === "tool-delete_task") {
    return withDetail("Delete recipe", detailFromInput(input));
  }
  if (part.type === "tool-reconnect_connection") {
    return withDetail(
      "Reconnect connection",
      typeof input?.connectionId === "string"
        ? input.connectionId
        : detailFromInput(input),
    );
  }
  if (part.type === "tool-disconnect_connection") {
    return withDetail(
      "Disconnect connection",
      typeof input?.connectionId === "string"
        ? input.connectionId
        : detailFromInput(input),
    );
  }
  if (part.type === "tool-remove_connection") {
    return withDetail(
      "Remove connection",
      typeof input?.connectionId === "string"
        ? input.connectionId
        : detailFromInput(input),
    );
  }
  if (part.type === "tool-search_connection_tools") {
    return withDetail("Search connection tools", detailFromInput(input));
  }
  if (part.type === "tool-describe_connection_tools") {
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · Inspect tools`,
      detailFromInput(input),
    );
  }
  if (part.type === "tool-activate_connection_tools") {
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · Activate tools`,
      detailFromInput(input),
    );
  }
  if (part.type === "tool-call_read_connection_tool") {
    const toolInput = asRecord(input?.input);
    return withDetail(
      `${humanize(input?.connectionId) || "Connection"} · ${humanize(input?.toolName) || "Read tool"}`,
      detailFromInput(toolInput),
    );
  }
  if (part.type === "tool-call_connection_tool") {
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
  const normalized = value.replaceAll(/[-_]+/g, " ").trim();
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
          ...(outcome.userAction === "none" ||
          outcome.userAction === "provide_source" ||
          outcome.userAction === "retry"
            ? { userAction: outcome.userAction }
            : {}),
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
