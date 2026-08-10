import type { ModelMessage, PrepareStepResult, ToolSet } from "ai";
import type { ChatSessionContext, ChatSessionIntent } from "./assistant.ts";
import { compactSupersededWebResearchMessages } from "./web-research-context.ts";

export const connectorSourceInspectionTool =
  "springroll_inspect_connector_source" as const;
export const connectorSourceSearchTool =
  "springroll_search_connector_sources" as const;
export const openApiDiscoveryTool = "springroll_discover_openapi" as const;

const applicationToolSearch = "springroll_search_application_tools" as const;
const applicationToolActivate =
  "springroll_activate_application_tools" as const;
const connectionToolSearch = "springroll_search_connection_tools" as const;
const connectionToolDescribe = "springroll_describe_connection_tools" as const;

const assistantToolPacks: Readonly<
  Record<ChatSessionIntent, readonly string[]>
> = {
  general: [
    applicationToolSearch,
    "springroll_describe_application_tools",
    applicationToolActivate,
    "springroll_get_application_state",
    "springroll_list_connections",
    "springroll_search_connection_tools",
    "springroll_describe_connection_tools",
    "springroll_call_read_connection_tool",
    "springroll_call_connection_tool",
  ],
  "connection.create": [
    applicationToolSearch,
    applicationToolActivate,
    "springroll_list_connections",
    "springroll_research_connection",
    connectorSourceSearchTool,
    connectorSourceInspectionTool,
    "reconnect_connection",
    "disconnect_connection",
    "remove_connection",
  ],
  "connection.manage": [
    applicationToolSearch,
    applicationToolActivate,
    "springroll_list_connections",
    "reconnect_connection",
    "disconnect_connection",
    "remove_connection",
  ],
  "task.create": [
    applicationToolSearch,
    applicationToolActivate,
    "springroll_list_connections",
    "springroll_get_model_configuration",
    "springroll_search_connection_tools",
    "springroll_describe_connection_tools",
    "springroll_activate_connection_tools",
    "create_task",
  ],
  "task.manage": [
    applicationToolSearch,
    applicationToolActivate,
    "springroll_list_tasks",
    "springroll_get_task",
    "update_task",
    "repair_task_tools",
    "run_task_now",
    "pause_task",
    "resume_task",
    "delete_task",
  ],
  "run.diagnose": [
    applicationToolSearch,
    applicationToolActivate,
    "springroll_get_task",
    "springroll_list_runs",
    "springroll_get_run",
    "repair_task_tools",
    "run_task_now",
    "pause_task",
    "resume_task",
    "delete_task",
  ],
};

interface AssistantStepHistoryMessage {
  readonly role: string;
  readonly parts: readonly unknown[];
}

export interface AssistantStepPolicyInput {
  readonly context: ChatSessionContext | null;
  readonly tools: ToolSet;
  readonly steps: readonly unknown[];
  readonly history: readonly AssistantStepHistoryMessage[];
  readonly messages: readonly ModelMessage[];
  readonly stepNumber: number;
  readonly connectorSourceUrl?: string | undefined;
  readonly instructions: string;
}

/**
 * Applies host-owned tool visibility and connector-evidence gates for one
 * interactive assistant step. This stays pure so policy changes can be tested
 * without starting a model stream.
 */
export function prepareAssistantStep(
  input: AssistantStepPolicyInput,
): Exclude<PrepareStepResult<ToolSet>, undefined> {
  const webCompactedMessages = compactSupersededWebResearchMessages(
    input.messages,
  );
  const messageOverride = webCompactedMessages
    ? { messages: webCompactedMessages }
    : {};
  const activeTools = activeAssistantTools(
    input.context,
    input.tools,
    input.steps,
    input.history,
  );
  if (connectionProposalValidationFailures(input.steps) >= 2) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: "none",
      instructions: `${input.instructions} Two connector proposal attempts failed host validation. Do not call another tool. Explain the exact remaining validation issues already present in the tool results, state that no proposal or connection was created, and give one concise next action.`,
    };
  }
  if (hasReadyAssistantProposal(input.steps)) {
    return {
      activeTools: [],
      toolChoice: "none",
      messages: compactConnectorResearchMessages(
        webCompactedMessages ?? input.messages,
      ),
      instructions: `${input.instructions} Springroll has created a native review proposal from the verified tool result, and its review card is already rendered in this chat. Do not call another tool, repeat the proposal payload, or tell the user to open or navigate to another page. Briefly tell the user what is ready and which explicit action to choose on the card.`,
    };
  }
  const unavailableConnection = requestedUnavailableConnection(input.steps);
  if (unavailableConnection) {
    return {
      ...messageOverride,
      activeTools: [],
      toolChoice: "none",
      instructions: `${input.instructions} Springroll's focused connection lookup says ${JSON.stringify(unavailableConnection)} has setup state unavailable because the app's OAuth client registration is not configured. Do not call reconnect, research, source inspection, or any other tool. Do not mention an endpoint, ask for documentation, a server URL, or credentials, or imply that setup will become available automatically. Reply in one short paragraph: ${unavailableConnection} sign-in is not available in this build; this is a Springroll release prerequisite and there is nothing the user needs to configure.`,
    };
  }
  if (
    hasUnactivatedApplicationToolSearch(input.steps) &&
    input.tools[applicationToolActivate]
  ) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: applicationToolActivate,
      },
      instructions: `${input.instructions} Springroll's application-capability search returned matches. Select and activate the smallest exact set needed from the most recent result. These names are Springroll application tools, never connection IDs or connected-tool names; do not pass them to a springroll_call_*_connection_tool wrapper.`,
    };
  }
  const githubCandidateRepository = uninspectedGithubCandidateRepository(
    input.steps,
  );
  if (githubCandidateRepository && input.tools[connectorSourceInspectionTool]) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: connectorSourceInspectionTool,
      },
      instructions: `${input.instructions} GitHub's MCP Registry returned ${JSON.stringify(githubCandidateRepository)} as a local-package candidate. Inspect that exact repository now. Do not propose or install the package until Springroll has returned the repository evidence.`,
    };
  }
  const openApiSource = undiscoveredOpenApiSource(input.steps);
  if (openApiSource && input.tools[openApiDiscoveryTool]) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: openApiDiscoveryTool,
      },
      instructions: `${input.instructions} Springroll inspected ${JSON.stringify(openApiSource)} and recognized an OpenAPI 3.x document. Run host OpenAPI discovery on that exact URL now so Springroll derives the server, authentication rail, exact operation names, schemas, and a safe probe candidate. Do not guess an operation name or ask for another confirmation.`,
    };
  }
  if (
    input.context?.intent === "general" &&
    hasUndescribedConnectionToolSearch(input.steps) &&
    input.tools[connectionToolDescribe]
  ) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: connectionToolDescribe,
      },
      instructions: `${input.instructions} Springroll connection-tool search returned at least one match. Describe the exact matching connection and relevant tool now to obtain its authoritative input schema and normalized effect before invoking it. Do not guess the input, use a read wrapper for a write-classified tool, or claim an approval exists unless Springroll actually returned one.`,
    };
  }
  if (
    hasUnfollowedConnectorResearchMiss(input.steps) &&
    input.tools[connectorSourceSearchTool]
  ) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: connectorSourceSearchTool,
      },
      instructions: `${input.instructions} Structured connector research did not return a usable path and explicitly directed Springroll to continue through official sources. Search now for the provider's official MCP setup, API or OpenAPI documentation, or provider-owned repository. Do not ask the user to research a URL before this search completes.`,
    };
  }
  if (
    hasUnfollowedInsufficientConnectorInspection(input.steps) &&
    input.tools[connectorSourceSearchTool]
  ) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: connectorSourceSearchTool,
      },
      instructions: `${input.instructions} The user-supplied official page was fetched, but Springroll could not extract a usable MCP endpoint, local package, provider repository, or OpenAPI document from it. Search public sources now for the provider's official MCP setup, API or OpenAPI documentation, or provider-owned repository. Do not ask the user to find another URL before this bounded fallback search completes.`,
    };
  }
  if (
    hasUninspectedConnectorSourceSearch(input.steps) &&
    input.tools[connectorSourceInspectionTool]
  ) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: connectorSourceInspectionTool,
      },
      instructions: `${input.instructions} Springroll returned public connector discovery leads in the immediately preceding search result. Select a new exact provider-owned documentation, repository, MCP setup, or OpenAPI URL from those results and inspect it now. Do not re-inspect a URL already inspected in this turn, and never choose a third-party aggregator or mirror. Prefer an exact provider-owned GitHub repository when the provider's main page says its endpoint documentation lives there. Do not propose, reconnect, or ask the user for a URL before this inspection completes.`,
    };
  }
  if (
    input.stepNumber === 0 &&
    input.connectorSourceUrl &&
    input.tools[connectorSourceInspectionTool]
  ) {
    return {
      ...messageOverride,
      activeTools,
      toolChoice: {
        type: "tool",
        toolName: connectorSourceInspectionTool,
      },
      instructions: input.instructions,
    };
  }
  return { ...messageOverride, activeTools };
}

function hasUnactivatedApplicationToolSearch(
  steps: readonly unknown[],
): boolean {
  let lastSearchStep = -1;
  let lastActivationStep = -1;
  for (const [index, step] of steps.entries()) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (!isUnknownObject(result)) continue;
      if (
        result.toolName === applicationToolSearch &&
        isUnknownObject(result.output) &&
        Array.isArray(result.output.matches) &&
        result.output.matches.length > 0
      ) {
        lastSearchStep = index;
      } else if (result.toolName === applicationToolActivate) {
        lastActivationStep = index;
      }
    }
  }
  return lastSearchStep > lastActivationStep;
}

function hasUninspectedConnectorSourceSearch(
  steps: readonly unknown[],
): boolean {
  let lastSearchStep = -1;
  const inspections: Array<{ readonly step: number; readonly url: string }> =
    [];
  for (const [index, step] of steps.entries()) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (!isUnknownObject(result)) continue;
      if (result.toolName === connectorSourceSearchTool) {
        lastSearchStep = index;
      } else if (
        result.toolName === connectorSourceInspectionTool &&
        isUnknownObject(result.output) &&
        typeof result.output.requestedUrl === "string"
      ) {
        inspections.push({ step: index, url: result.output.requestedUrl });
      }
    }
  }
  if (lastSearchStep < 0) return false;
  const urlsBeforeSearch = new Set(
    inspections
      .filter((inspection) => inspection.step < lastSearchStep)
      .map((inspection) => inspection.url),
  );
  return !inspections.some(
    (inspection) =>
      inspection.step > lastSearchStep && !urlsBeforeSearch.has(inspection.url),
  );
}

function hasUndescribedConnectionToolSearch(
  steps: readonly unknown[],
): boolean {
  let lastSearchStep = -1;
  let lastDescribeStep = -1;
  for (const [index, step] of steps.entries()) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (!isUnknownObject(result)) continue;
      if (
        result.toolName === connectionToolSearch &&
        isUnknownObject(result.output) &&
        Array.isArray(result.output.matches) &&
        result.output.matches.length > 0
      ) {
        lastSearchStep = index;
      } else if (result.toolName === connectionToolDescribe) {
        lastDescribeStep = index;
      }
    }
  }
  return lastSearchStep > lastDescribeStep;
}

function undiscoveredOpenApiSource(
  steps: readonly unknown[],
): string | undefined {
  let candidate: { readonly step: number; readonly url: string } | undefined;
  let lastDiscoveryStep = -1;
  for (const [index, step] of steps.entries()) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (!isUnknownObject(result)) continue;
      if (result.toolName === openApiDiscoveryTool) {
        lastDiscoveryStep = index;
        continue;
      }
      if (
        result.toolName !== connectorSourceInspectionTool ||
        !isUnknownObject(result.output) ||
        typeof result.output.requestedUrl !== "string" ||
        typeof result.output.content !== "string" ||
        !/["']openapi["']\s*:\s*["']3\./i.test(result.output.content)
      ) {
        continue;
      }
      candidate = { step: index, url: result.output.requestedUrl };
    }
  }
  return candidate && candidate.step > lastDiscoveryStep
    ? candidate.url
    : undefined;
}

function hasUnfollowedConnectorResearchMiss(
  steps: readonly unknown[],
): boolean {
  let lastRecoverableMissStep = -1;
  let lastSearchStep = -1;
  for (const [index, step] of steps.entries()) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (!isUnknownObject(result)) continue;
      if (result.toolName === connectorSourceSearchTool) {
        lastSearchStep = index;
        continue;
      }
      if (
        result.toolName !== "springroll_research_connection" ||
        !isUnknownObject(result.output) ||
        (result.output.status !== "not_found" &&
          result.output.status !== "unavailable") ||
        typeof result.output.explanation !== "string" ||
        !/continue (?:with|through) official/i.test(result.output.explanation)
      ) {
        continue;
      }
      lastRecoverableMissStep = index;
    }
  }
  return lastRecoverableMissStep > lastSearchStep;
}

function hasUnfollowedInsufficientConnectorInspection(
  steps: readonly unknown[],
): boolean {
  let lastSearchStep = -1;
  let lastInspection:
    | { readonly step: number; readonly output: Record<string, unknown> }
    | undefined;
  for (const [index, step] of steps.entries()) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (!isUnknownObject(result)) continue;
      if (result.toolName === connectorSourceSearchTool) {
        lastSearchStep = index;
      } else if (
        result.toolName === connectorSourceInspectionTool &&
        isUnknownObject(result.output)
      ) {
        lastInspection = { step: index, output: result.output };
      }
    }
  }
  return Boolean(
    lastInspection &&
      lastSearchStep < 0 &&
      lastInspection.step >= lastSearchStep &&
      !hasUsableConnectorConfiguration(lastInspection.output),
  );
}

function hasUsableConnectorConfiguration(
  output: Readonly<Record<string, unknown>>,
): boolean {
  if (output.status === "unavailable") return false;
  if (
    (Array.isArray(output.npmPackages) && output.npmPackages.length > 0) ||
    (Array.isArray(output.repositoryUrls) && output.repositoryUrls.length > 0)
  ) {
    return true;
  }
  if (typeof output.content !== "string") return false;
  return (
    /["']openapi["']\s*:\s*["']3\./i.test(output.content) ||
    /https?:\/\/[^\s"'<>]*(?:\/mcp(?:\b|\/)|mcp\.)/i.test(output.content) ||
    /(?:^|\s)(?:npx|bunx|uvx|docker)\s+[^\s]+/im.test(output.content) ||
    /(?:npm:)?@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/i.test(output.content)
  );
}

function connectionProposalValidationFailures(
  steps: readonly unknown[],
): number {
  const proposalTools = new Set([
    "springroll_propose_connection",
    "springroll_propose_local_mcp",
    "springroll_propose_openapi_connection",
  ]);
  let failedSteps = 0;
  for (const step of steps) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    const failed = step.toolResults.some(
      (result) =>
        isUnknownObject(result) &&
        typeof result.toolName === "string" &&
        proposalTools.has(result.toolName) &&
        isUnknownObject(result.output) &&
        result.output.status === "invalid_input",
    );
    if (failed) {
      // Calls generated in one model step are one attempt because the model
      // has not seen any of their results yet.
      failedSteps += 1;
    }
  }
  return failedSteps;
}

function activeAssistantTools(
  context: ChatSessionContext | null,
  tools: ToolSet,
  steps: readonly unknown[],
  history: readonly AssistantStepHistoryMessage[],
): string[] {
  const available = new Set(Object.keys(tools));
  const hasApplicationCatalog =
    available.has(applicationToolSearch) &&
    available.has(applicationToolActivate);
  if (!hasApplicationCatalog) {
    // Tests and embedders may supply a narrow custom tool set rather than the
    // Springroll registry. It is already scoped, so preserve it unchanged.
    return [...available];
  }
  const intent = context?.intent ?? "general";
  const selected = new Set(assistantToolPacks[intent]);
  if (
    intent === "connection.create" &&
    hasInspectedConnectorEvidence(steps, history)
  ) {
    selected.add(openApiDiscoveryTool);
    selected.add("springroll_propose_connection");
  }
  for (const name of activatedApplicationToolNames(steps, history)) {
    selected.add(name);
  }
  for (const name of available) {
    if (!name.startsWith("springroll_")) selected.add(name);
  }
  return [...selected].filter((name) => available.has(name));
}

function hasInspectedConnectorEvidence(
  steps: readonly unknown[],
  history: readonly AssistantStepHistoryMessage[],
): boolean {
  const currentTurnEvidence = steps.some(
    (step) =>
      isUnknownObject(step) &&
      Array.isArray(step.toolResults) &&
      step.toolResults.some(
        (result) =>
          isUnknownObject(result) &&
          ((result.toolName === connectorSourceInspectionTool &&
            isUnknownObject(result.output) &&
            result.output.status !== "unavailable") ||
            result.toolName === "springroll_discover_openapi" ||
            result.toolName === "springroll_call_read_connection_tool"),
      ),
  );
  if (currentTurnEvidence) return true;
  return history.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) =>
          isUnknownObject(part) &&
          ((part.type === `tool-${connectorSourceInspectionTool}` &&
            isUnknownObject(part.output) &&
            part.output.status !== "unavailable") ||
            part.type === "tool-springroll_discover_openapi" ||
            part.type === "tool-springroll_call_read_connection_tool") &&
          part.state === "output-available",
      ),
  );
}

function isConnectorSourceTool(name: string): boolean {
  return (
    name === connectorSourceInspectionTool ||
    name === "springroll_discover_openapi" ||
    name === "springroll_call_read_connection_tool"
  );
}

function boundConnectorResearchOutput(output: unknown, limit: number): unknown {
  const encoded = JSON.stringify(output);
  if (encoded.length <= limit) return output;
  if (isUnknownObject(output) && typeof output.content === "string") {
    const withoutContent = { ...output, content: "" };
    const availableContent = Math.max(
      0,
      limit - JSON.stringify(withoutContent).length - 120,
    );
    return {
      ...withoutContent,
      content: `${output.content.slice(0, availableContent)}\n\n[Connector evidence truncated by Springroll]`,
      truncated: true,
    };
  }
  return {
    truncated: true,
    preview: encoded.slice(0, Math.max(0, limit - 160)),
    note: "Older connector evidence was compacted to keep the conversation useful.",
  };
}

function compactConnectorResearchMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((part) => {
      if (
        part.type !== "tool-result" ||
        !isConnectorSourceTool(part.toolName)
      ) {
        return part;
      }
      if (
        (part.output.type === "json" || part.output.type === "error-json") &&
        JSON.stringify(part.output.value).length > 2_500
      ) {
        changed = true;
        return {
          ...part,
          output: {
            ...part.output,
            value: boundConnectorResearchOutput(part.output.value, 2_500),
          },
        };
      }
      if (
        (part.output.type === "text" || part.output.type === "error-text") &&
        part.output.value.length > 2_500
      ) {
        changed = true;
        return {
          ...part,
          output: {
            ...part.output,
            value: `${part.output.value.slice(0, 2_400)}\n\n[Connector evidence compacted for the final response]`,
          },
        };
      }
      return part;
    });
    return changed ? ({ ...message, content } as ModelMessage) : message;
  });
}

function activatedApplicationToolNames(
  steps: readonly unknown[],
  history: readonly AssistantStepHistoryMessage[],
): string[] {
  const activated = new Set<string>();
  for (const step of steps) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (
        !isUnknownObject(result) ||
        result.toolName !== applicationToolActivate ||
        !isUnknownObject(result.output) ||
        !Array.isArray(result.output.activatedToolNames)
      ) {
        continue;
      }
      for (const name of result.output.activatedToolNames) {
        if (typeof name === "string") activated.add(name);
      }
    }
  }
  for (const message of history) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (
        !isUnknownObject(part) ||
        part.type !== `tool-${applicationToolActivate}` ||
        part.state !== "output-available" ||
        !isUnknownObject(part.output) ||
        !Array.isArray(part.output.activatedToolNames)
      ) {
        continue;
      }
      for (const name of part.output.activatedToolNames) {
        if (typeof name === "string") activated.add(name);
      }
    }
  }
  return [...activated];
}

function hasReadyAssistantProposal(steps: readonly unknown[]): boolean {
  for (const step of steps) {
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    if (
      step.toolResults.some(
        (result) =>
          isUnknownObject(result) &&
          typeof result.toolName === "string" &&
          result.toolName.startsWith("springroll_propose_") &&
          isUnknownObject(result.output) &&
          result.output.status === "ready" &&
          isUnknownObject(result.output.proposal),
      )
    ) {
      return true;
    }
  }
  return false;
}

function requestedUnavailableConnection(
  steps: readonly unknown[],
): string | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!isUnknownObject(step) || !Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (
        !isUnknownObject(result) ||
        result.toolName !== "springroll_list_connections" ||
        !isUnknownObject(result.output) ||
        result.output.filtered !== true ||
        !Array.isArray(result.output.connections)
      ) {
        continue;
      }
      const blocked = result.output.connections.find(
        (connection) =>
          isUnknownObject(connection) &&
          connection.setup === "unavailable" &&
          connection.oauthReady === false &&
          typeof connection.blocker === "string",
      );
      return isUnknownObject(blocked) && typeof blocked.name === "string"
        ? blocked.name
        : undefined;
    }
  }
  return undefined;
}

function uninspectedGithubCandidateRepository(
  steps: readonly unknown[],
): string | undefined {
  const inspected = new Set<string>();
  let candidate: string | undefined;
  for (const step of steps) {
    if (!isUnknownObject(step)) continue;
    if (Array.isArray(step.toolCalls)) {
      for (const call of step.toolCalls) {
        if (
          !isUnknownObject(call) ||
          call.toolName !== connectorSourceInspectionTool ||
          !isUnknownObject(call.input) ||
          typeof call.input.url !== "string"
        ) {
          continue;
        }
        inspected.add(call.input.url);
      }
    }
    if (!Array.isArray(step.toolResults)) continue;
    for (const result of step.toolResults) {
      if (
        !isUnknownObject(result) ||
        result.toolName !== "springroll_research_connection" ||
        !isUnknownObject(result.output) ||
        result.output.status !== "candidate" ||
        !isUnknownObject(result.output.candidate) ||
        result.output.candidate.kind !== "local-mcp" ||
        typeof result.output.candidate.repositoryUrl !== "string"
      ) {
        continue;
      }
      candidate = result.output.candidate.repositoryUrl;
    }
  }
  return candidate && !inspected.has(candidate) ? candidate : undefined;
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
