import type { ExecutionLocation } from "./contracts.ts";

export type AgentRuntimeId =
  | "openai"
  | "xai"
  | "openrouter"
  | "codex-harness"
  | "claude-code-harness"
  | "pi-harness";

export type AgentRuntimeKind = "ai-sdk-provider" | "ai-sdk-harness";
export type AgentRuntimeAvailability = "available" | "planned";
export type AgentAuthenticationMode = "api-key" | "existing-cli-session";
export type CostAccountingMode =
  | "provider-reported"
  | "model-pricing"
  | "subscription"
  | "unknown";

export interface AgentRuntimeCapabilities {
  readonly hostTools: boolean;
  readonly nativeResumeState: boolean;
  readonly normalizedTokenUsage: boolean;
  readonly costAccounting: readonly CostAccountingMode[];
  readonly builtInToolControl: "not-applicable" | "full" | "limited";
}

export interface AgentRuntimeDescriptor {
  readonly id: AgentRuntimeId;
  readonly label: string;
  readonly kind: AgentRuntimeKind;
  readonly packageName: string;
  readonly stability: "stable" | "experimental";
  readonly availability: AgentRuntimeAvailability;
  readonly executionLocations: readonly ExecutionLocation[];
  readonly authentication: readonly AgentAuthenticationMode[];
  readonly capabilities: AgentRuntimeCapabilities;
  readonly notes: readonly string[];
}

export interface AgentRuntimeRequirements {
  readonly executionLocation?: ExecutionLocation;
  readonly authentication?: AgentAuthenticationMode;
  readonly hostTools?: boolean;
  readonly nativeResumeState?: boolean;
  readonly requireAvailable?: boolean;
  readonly requireFullBuiltInToolControl?: boolean;
}

export interface AgentRuntimeCompatibility {
  readonly runtime: AgentRuntimeDescriptor;
  readonly compatible: boolean;
  readonly issues: readonly string[];
}

export const agentRuntimeCatalog: readonly AgentRuntimeDescriptor[] = [
  {
    id: "openai",
    label: "OpenAI API",
    kind: "ai-sdk-provider",
    packageName: "@ai-sdk/openai",
    stability: "stable",
    availability: "available",
    executionLocations: ["local", "hosted"],
    authentication: ["api-key"],
    capabilities: {
      hostTools: true,
      nativeResumeState: false,
      normalizedTokenUsage: true,
      costAccounting: ["model-pricing"],
      builtInToolControl: "not-applicable",
    },
    notes: [
      "Uses the OpenAI Responses API with Springroll-controlled tools.",
      "Subscription-backed Codex access is a separate harness concern.",
    ],
  },
  {
    id: "xai",
    label: "xAI Grok API",
    kind: "ai-sdk-provider",
    packageName: "@ai-sdk/xai",
    stability: "stable",
    availability: "available",
    executionLocations: ["local", "hosted"],
    authentication: ["api-key"],
    capabilities: {
      hostTools: true,
      nativeResumeState: false,
      normalizedTokenUsage: true,
      costAccounting: ["model-pricing"],
      builtInToolControl: "not-applicable",
    },
    notes: [
      "Uses xAI's Chat API so Springroll host tools remain available.",
      "The connection reads current token pricing from xAI's model endpoint.",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "ai-sdk-provider",
    packageName: "@openrouter/ai-sdk-provider",
    stability: "stable",
    availability: "available",
    executionLocations: ["local", "hosted"],
    authentication: ["api-key"],
    capabilities: {
      hostTools: true,
      nativeResumeState: false,
      normalizedTokenUsage: true,
      costAccounting: ["provider-reported", "model-pricing"],
      builtInToolControl: "not-applicable",
    },
    notes: [
      "Supports a broad model catalog and provider-reported generation cost.",
      "Provider-hosted web tools require the OpenRouter AI SDK runtime.",
    ],
  },
  {
    id: "codex-harness",
    label: "Codex harness",
    kind: "ai-sdk-harness",
    packageName: "@ai-sdk/harness-codex",
    stability: "experimental",
    availability: "planned",
    executionLocations: ["local", "hosted"],
    authentication: ["api-key"],
    capabilities: {
      hostTools: true,
      nativeResumeState: true,
      normalizedTokenUsage: true,
      costAccounting: ["unknown"],
      builtInToolControl: "limited",
    },
    notes: [
      "The current adapter requires broad built-in tool permission and cannot fully filter Codex built-ins.",
      "Do not treat ChatGPT subscription authentication as verified for this adapter.",
    ],
  },
  {
    id: "claude-code-harness",
    label: "Claude Code harness",
    kind: "ai-sdk-harness",
    packageName: "@ai-sdk/harness-claude-code",
    stability: "experimental",
    availability: "planned",
    executionLocations: ["local", "hosted"],
    authentication: ["api-key"],
    capabilities: {
      hostTools: true,
      nativeResumeState: true,
      normalizedTokenUsage: true,
      costAccounting: ["unknown"],
      builtInToolControl: "full",
    },
    notes: [
      "Supports host tools plus built-in tool approval and filtering.",
      "Claude subscription authentication still needs a live conformance check.",
    ],
  },
  {
    id: "pi-harness",
    label: "Pi harness",
    kind: "ai-sdk-harness",
    packageName: "@ai-sdk/harness-pi",
    stability: "experimental",
    availability: "planned",
    executionLocations: ["local", "hosted"],
    authentication: ["api-key", "existing-cli-session"],
    capabilities: {
      hostTools: true,
      nativeResumeState: true,
      normalizedTokenUsage: true,
      costAccounting: ["subscription", "unknown"],
      builtInToolControl: "full",
    },
    notes: [
      "Can reuse a local Pi agent directory for existing provider authentication.",
      "The adapter's normalized usage must be checked against Pi's native cost data.",
    ],
  },
] as const;

const runtimesById = new Map(
  agentRuntimeCatalog.map((runtime) => [runtime.id, runtime]),
);

export function getAgentRuntime(id: AgentRuntimeId): AgentRuntimeDescriptor {
  const runtime = runtimesById.get(id);
  if (!runtime) {
    throw new RangeError(`Unknown agent runtime: ${id}`);
  }
  return runtime;
}

export function checkAgentRuntimeCompatibility(
  id: AgentRuntimeId,
  requirements: AgentRuntimeRequirements,
): AgentRuntimeCompatibility {
  const runtime = getAgentRuntime(id);
  const issues: string[] = [];

  if (
    requirements.executionLocation &&
    !runtime.executionLocations.includes(requirements.executionLocation)
  ) {
    issues.push(
      `${runtime.label} cannot run in ${requirements.executionLocation}`,
    );
  }
  if (
    requirements.authentication &&
    !runtime.authentication.includes(requirements.authentication)
  ) {
    issues.push(
      `${runtime.label} does not support ${requirements.authentication} authentication`,
    );
  }
  if (requirements.hostTools && !runtime.capabilities.hostTools) {
    issues.push(`${runtime.label} cannot execute Springroll host tools`);
  }
  if (
    requirements.nativeResumeState &&
    !runtime.capabilities.nativeResumeState
  ) {
    issues.push(`${runtime.label} does not expose native resume state`);
  }
  if (
    requirements.requireFullBuiltInToolControl &&
    runtime.capabilities.builtInToolControl !== "full"
  ) {
    issues.push(
      `${runtime.label} does not provide full control over built-in tools`,
    );
  }
  if (requirements.requireAvailable && runtime.availability !== "available") {
    issues.push(`${runtime.label} is not implemented in Springroll yet`);
  }

  return {
    runtime,
    compatible: issues.length === 0,
    issues,
  };
}
