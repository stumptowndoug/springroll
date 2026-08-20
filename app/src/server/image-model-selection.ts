import { imageGenerationModelHandle } from "@springroll/kernel";
import type { ModelOptionDto, ModelSelectionDto } from "../shared.ts";

const automaticAliases: readonly ModelSelectionDto[] = [
  {
    providerId: "openrouter",
    modelId: "openrouter/auto",
  },
  { providerId: "openai", modelId: "chatgpt-image-latest" },
];

export function chooseImageModel(
  available: readonly ModelOptionDto[],
  configured?: { readonly providerId: string; readonly modelId: string },
): ModelOptionDto | undefined {
  const selected = configured
    ? available.find((model) => matches(model, configured))
    : undefined;
  if (selected) return selected;

  for (const recommendation of automaticAliases) {
    const model = available.find((candidate) =>
      matches(candidate, recommendation),
    );
    if (model) return model;
  }
  return available.length === 1 ? available[0] : undefined;
}

export function chooseImageModelForCall(
  available: readonly ModelOptionDto[],
  configured:
    | { readonly providerId: string; readonly modelId: string }
    | undefined,
  requestedHandle?: string,
): ModelOptionDto | undefined {
  if (!requestedHandle) return chooseImageModel(available, configured);
  const requested = available.find(
    (model) =>
      imageGenerationModelHandle(model.providerId, model.modelId) ===
      requestedHandle,
  );
  if (requested) return requested;
  throw new TypeError(
    `Image model is not connected or compatible: ${requestedHandle}`,
  );
}

function matches(
  model: ModelSelectionDto,
  selection: { readonly providerId: string; readonly modelId: string },
): boolean {
  return (
    model.providerId === selection.providerId &&
    model.modelId === selection.modelId
  );
}
