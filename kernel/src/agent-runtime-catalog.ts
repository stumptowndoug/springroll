import type { ExecutionLocation } from "./contracts.ts";

export type AgentRuntimeId = "openai" | "xai" | "openrouter";

export type AgentRuntimeKind = "ai-sdk-provider";
export type AgentRuntimeAvailability = "available";
export type AgentAuthenticationMode = "api-key";
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
      "Optional local CLI integrations belong behind separately permissioned AI SDK tools, not in the agent runtime catalog.",
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
