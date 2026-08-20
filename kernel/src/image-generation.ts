import { generateImage, type ImageModel } from "ai";

export const imageOrientations = ["square", "landscape", "portrait"] as const;
export const imageModelSettingId = "image";

export type ImageOrientation = (typeof imageOrientations)[number];

export interface ImageModelDefinition {
  readonly providerId: "openai" | "openrouter" | "xai";
  readonly modelId: string;
  readonly name: string;
  readonly settings: Readonly<
    Record<
      ImageOrientation,
      | { readonly size: `${number}x${number}` }
      | { readonly aspectRatio: `${number}:${number}` }
    >
  >;
}

export const imageModelDefinitions: readonly ImageModelDefinition[] = [
  {
    providerId: "openai",
    modelId: "gpt-image-2",
    name: "GPT Image 2",
    settings: {
      square: { size: "1024x1024" },
      landscape: { size: "1536x1024" },
      portrait: { size: "1024x1536" },
    },
  },
];

export interface GeneratedImage {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export interface ImageGenerationResult {
  readonly images: readonly GeneratedImage[];
  readonly providerId: string;
  readonly modelId: string;
  readonly billing?: "metered" | "subscription" | "unknown";
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsdMicros?: number;
  readonly actualCostUsdMicros?: number;
  readonly estimatedCostUsdMicros?: number;
  readonly costSource?: "provider_reported" | "catalog_estimate";
}

export type ImageGenerationProviderUsage = Pick<
  ImageGenerationResult,
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "costUsdMicros"
  | "actualCostUsdMicros"
  | "estimatedCostUsdMicros"
  | "costSource"
>;

export interface ImageGenerationServiceOptions {
  readonly pricing?: {
    readonly inputUsdPerMillionTokens: number;
    readonly outputUsdPerMillionTokens: number;
  };
  readonly providerUsage?: {
    read(): ImageGenerationProviderUsage;
  };
}

export interface ImageGenerationModelOption {
  readonly handle: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly name: string;
  readonly inputModalities?: readonly string[];
}

export interface ImageGenerationReference {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export interface ImageGenerationRequest {
  readonly prompt: string;
  readonly orientation: ImageOrientation;
  readonly references?: readonly ImageGenerationReference[];
  /** A runtime-scoped model handle. Omitted requests use the configured default. */
  readonly model?: string;
  readonly taskId?: string;
  readonly signal?: AbortSignal;
}

export interface ImageGenerationService {
  generate(input: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface ImageGenerationToolRuntime extends ImageGenerationService {
  listModels(): Promise<readonly ImageGenerationModelOption[]>;
}

export class AiSdkImageGenerationService implements ImageGenerationService {
  constructor(
    private readonly model: ImageModel,
    private readonly definition: ImageModelDefinition,
    private readonly options: ImageGenerationServiceOptions = {},
  ) {}

  async generate(
    input: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new TypeError("Image prompt must not be empty");
    if (!imageOrientations.includes(input.orientation)) {
      throw new TypeError(
        `Unsupported image orientation: ${input.orientation}`,
      );
    }
    const settings = this.definition.settings[input.orientation];
    const result = await generateImage({
      model: this.model,
      prompt: input.references?.length
        ? { text: prompt, images: input.references.map((image) => image.bytes) }
        : prompt,
      n: 1,
      ...settings,
      ...(input.signal ? { abortSignal: input.signal } : undefined),
    });
    const providerUsage = this.options.providerUsage?.read() ?? {};
    const inputTokens = providerUsage.inputTokens ?? result.usage.inputTokens;
    const outputTokens =
      providerUsage.outputTokens ?? result.usage.outputTokens;
    const totalTokens = providerUsage.totalTokens ?? result.usage.totalTokens;
    const estimatedCostUsdMicros =
      this.options.pricing &&
      (inputTokens !== undefined || outputTokens !== undefined)
        ? Math.round(
            (inputTokens ?? 0) * this.options.pricing.inputUsdPerMillionTokens +
              (outputTokens ?? 0) *
                this.options.pricing.outputUsdPerMillionTokens,
          )
        : undefined;
    const actualCostUsdMicros = providerUsage.actualCostUsdMicros;
    const costUsdMicros =
      providerUsage.costUsdMicros ??
      actualCostUsdMicros ??
      estimatedCostUsdMicros;
    const costSource =
      providerUsage.costSource ??
      (actualCostUsdMicros !== undefined
        ? "provider_reported"
        : estimatedCostUsdMicros !== undefined
          ? "catalog_estimate"
          : undefined);

    return {
      images: result.images.map((image) => ({
        bytes: image.uint8Array,
        mediaType: image.mediaType,
      })),
      providerId: this.definition.providerId,
      modelId: this.definition.modelId,
      billing: "metered",
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
      ...(costUsdMicros === undefined ? {} : { costUsdMicros }),
      ...(actualCostUsdMicros === undefined ? {} : { actualCostUsdMicros }),
      ...(estimatedCostUsdMicros === undefined
        ? {}
        : { estimatedCostUsdMicros }),
      ...(costSource === undefined ? {} : { costSource }),
    };
  }
}

export function imageGenerationModelHandle(
  providerId: string,
  modelId: string,
): string {
  return `${providerId}:${modelId}`;
}

export function findImageModelDefinition(
  providerId: string,
  modelId: string,
  name = modelId,
): ImageModelDefinition | undefined {
  const curated = imageModelDefinitions.find(
    (definition) =>
      definition.providerId === providerId && definition.modelId === modelId,
  );
  if (curated) return curated;
  if (providerId === "openai") {
    return {
      providerId,
      modelId,
      name,
      settings: {
        square: { size: "1024x1024" },
        landscape: { size: "1536x1024" },
        portrait: { size: "1024x1536" },
      },
    };
  }
  if (providerId === "openrouter") {
    return {
      providerId,
      modelId,
      name,
      settings: {
        square: { aspectRatio: "1:1" },
        landscape: { aspectRatio: "16:9" },
        portrait: { aspectRatio: "9:16" },
      },
    };
  }
  if (providerId === "xai") {
    return {
      providerId,
      modelId,
      name,
      settings: {
        square: { aspectRatio: "1:1" },
        landscape: { aspectRatio: "16:9" },
        portrait: { aspectRatio: "9:16" },
      },
    };
  }
  return undefined;
}
