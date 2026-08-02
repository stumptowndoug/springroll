import {
  type ProviderToolCapability,
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
} from "@springroll/kernel";
import type {
  ModelExecutionDto,
  ModelProviderId,
  ModelSelectionDto,
  ModelToolRouteDto,
} from "../shared.ts";

export interface ChooseModelSelectionOptions {
  readonly taskSelection?:
    | { readonly providerId: string; readonly modelId: string }
    | undefined;
  readonly defaultSelection?: ModelSelectionDto | undefined;
  readonly automaticSelections: readonly ModelSelectionDto[];
  readonly connectedProviders: ReadonlySet<ModelProviderId>;
  readonly requiredCapabilities: readonly ProviderToolCapability[];
  readonly portableCapabilities?: ReadonlySet<ProviderToolCapability>;
}

const providerCapabilities: Readonly<
  Record<ModelProviderId, ReadonlySet<ProviderToolCapability>>
> = {
  openrouter: new Set([
    webSearchProviderToolCapability,
    webFetchProviderToolCapability,
  ]),
  openai: new Set(),
  xai: new Set(),
};

export function chooseModelSelection(
  options: ChooseModelSelectionOptions,
): ModelSelectionDto {
  const execution = chooseModelExecution(options);
  return {
    providerId: execution.providerId,
    modelId: execution.modelId,
  };
}

export function chooseModelExecution(
  options: ChooseModelSelectionOptions,
): ModelExecutionDto {
  if (options.taskSelection) {
    const selection = validateSelection(options.taskSelection);
    assertConnected(selection, options.connectedProviders);
    assertCapabilities(
      selection,
      options.requiredCapabilities,
      options.portableCapabilities,
    );
    return toExecution(
      selection,
      "task",
      options.requiredCapabilities,
      options.portableCapabilities,
    );
  }

  if (options.defaultSelection) {
    assertConnected(options.defaultSelection, options.connectedProviders);
    assertCapabilities(
      options.defaultSelection,
      options.requiredCapabilities,
      options.portableCapabilities,
    );
    return toExecution(
      options.defaultSelection,
      "default",
      options.requiredCapabilities,
      options.portableCapabilities,
    );
  }

  for (const selection of options.automaticSelections) {
    if (!options.connectedProviders.has(selection.providerId)) continue;
    if (
      !supportsCapabilities(
        selection.providerId,
        options.requiredCapabilities,
        options.portableCapabilities,
      )
    ) {
      continue;
    }
    return toExecution(
      selection,
      "automatic",
      options.requiredCapabilities,
      options.portableCapabilities,
    );
  }

  if (options.requiredCapabilities.length > 0) {
    throw new Error(
      `Connect a model provider that supports ${options.requiredCapabilities.join(", ")} before running this task`,
    );
  }
  throw new Error("Connect an AI provider before running this task");
}

function toExecution(
  selection: ModelSelectionDto,
  selectedBy: ModelExecutionDto["selectedBy"],
  requiredCapabilities: readonly ProviderToolCapability[],
  portableCapabilities: ReadonlySet<ProviderToolCapability> = new Set(),
): ModelExecutionDto {
  return {
    ...selection,
    selectedBy,
    toolRoutes: requiredCapabilities.map((capability) =>
      providerCapabilities[selection.providerId].has(capability)
        ? providerToolRoute(selection.providerId, capability)
        : portableToolRoute(capability, portableCapabilities),
    ),
  };
}

function providerToolRoute(
  providerId: ModelProviderId,
  capability: ProviderToolCapability,
): ModelToolRouteDto {
  return {
    capability,
    profile: providerId === "openrouter" ? "managed-auto" : "native",
    service: providerId,
  };
}

function portableToolRoute(
  capability: ProviderToolCapability,
  portableCapabilities: ReadonlySet<ProviderToolCapability>,
): ModelToolRouteDto {
  if (!portableCapabilities.has(capability)) {
    throw new Error(`No execution route is available for ${capability}`);
  }
  return {
    capability,
    profile: "portable",
    service: "exa",
  };
}

export function supportsCapabilities(
  providerId: ModelProviderId,
  requiredCapabilities: readonly ProviderToolCapability[],
  portableCapabilities: ReadonlySet<ProviderToolCapability> = new Set(),
): boolean {
  const available = providerCapabilities[providerId];
  return requiredCapabilities.every(
    (capability) =>
      available.has(capability) || portableCapabilities.has(capability),
  );
}

function validateSelection(selection: {
  readonly providerId: string;
  readonly modelId: string;
}): ModelSelectionDto {
  if (!isModelProviderId(selection.providerId)) {
    throw new Error(`Unsupported AI provider: ${selection.providerId}`);
  }
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
  };
}

function assertConnected(
  selection: ModelSelectionDto,
  connectedProviders: ReadonlySet<ModelProviderId>,
): void {
  if (!connectedProviders.has(selection.providerId)) {
    throw new Error(
      `The selected ${selection.providerId} model ${selection.modelId} is not connected`,
    );
  }
}

function assertCapabilities(
  selection: ModelSelectionDto,
  requiredCapabilities: readonly ProviderToolCapability[],
  portableCapabilities: ReadonlySet<ProviderToolCapability> = new Set(),
): void {
  const missing = requiredCapabilities.filter(
    (capability) =>
      !providerCapabilities[selection.providerId].has(capability) &&
      !portableCapabilities.has(capability),
  );
  if (missing.length === 0) return;

  throw new Error(
    `The selected ${selection.providerId} model ${selection.modelId} cannot currently provide ${missing.join(", ")}. Springroll did not substitute another model.`,
  );
}

function isModelProviderId(value: string): value is ModelProviderId {
  return value === "openrouter" || value === "openai" || value === "xai";
}
