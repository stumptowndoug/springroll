import type { ToolSet } from "ai";

export const webSearchProviderToolCapability = "web.search";
export const webFetchProviderToolCapability = "web.fetch";

export type ProviderToolCapability =
  | typeof webSearchProviderToolCapability
  | typeof webFetchProviderToolCapability;

export type ProviderToolExecutionProfile =
  | "managed-auto"
  | "native"
  | "portable";

export interface ProviderToolReference {
  readonly capability: ProviderToolCapability;
}

export interface ProviderToolBinding {
  readonly profile: ProviderToolExecutionProfile;
  readonly tool: ToolSet[string];
}

export type ProviderToolBindings = Readonly<
  Partial<Record<ProviderToolCapability, ProviderToolBinding>>
>;

export function requiredProviderToolCapabilities(
  tools: readonly {
    readonly descriptor: {
      readonly providerTool?: ProviderToolReference;
    };
  }[],
): readonly ProviderToolCapability[] {
  return [
    ...new Set(
      tools.flatMap((tool) =>
        tool.descriptor.providerTool
          ? [tool.descriptor.providerTool.capability]
          : [],
      ),
    ),
  ];
}
