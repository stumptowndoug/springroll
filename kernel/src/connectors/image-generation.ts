import {
  type ImageGenerationService,
  type ImageOrientation,
  imageOrientations,
} from "../image-generation.ts";
import type { ArtifactBlobStore } from "../storage/artifact-blob-store.ts";
import {
  type ImageArtifactMediaType,
  type RunImageArtifact,
  type SqliteRunArtifactRepository,
  toRunResultImageArtifact,
} from "../storage/sqlite-run-artifact-repository.ts";
import {
  createNativeToolSource,
  type JsonObject,
  type JsonValue,
  type NativeTool,
  type ToolSource,
} from "../tools.ts";

export const imageGenerationSourceId = "native.image-generation";
export const imageGenerationConnectionId = "builtin-image-generation";
export const imageGenerationCredentialRef = "image-generation-model";
export const imageGenerationCardId = "image-generation";

export interface ImageGenerationToolSourceOptions {
  readonly generation: ImageGenerationService;
  readonly blobs: ArtifactBlobStore;
  readonly artifacts: SqliteRunArtifactRepository;
}

export function createImageGenerationToolSource(
  options: ImageGenerationToolSourceOptions,
): ToolSource {
  const generateImageTool: NativeTool = {
    descriptor: {
      name: "generate_image",
      description:
        "Generate one image with Springroll's configured image model and save it to this run.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "A complete visual description of the image to create.",
            minLength: 1,
            maxLength: 32_000,
          },
          orientation: {
            type: "string",
            enum: imageOrientations,
            description: "The output canvas orientation.",
          },
          title: {
            type: "string",
            description: "A short title shown with the generated image.",
            minLength: 1,
            maxLength: 200,
          },
          alt: {
            type: "string",
            description: "Concise accessible text describing the image.",
            minLength: 1,
            maxLength: 1_000,
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          artifacts: { type: "array" },
          imageCount: { type: "integer" },
        },
        required: ["artifacts", "imageCount"],
      },
      declaredRisk: {
        effect: "write",
        openWorld: true,
        idempotent: false,
      },
    },
    async execute(input, context) {
      if (context.taskId === "interactive-assistant") {
        throw new Error(
          "Image generation is currently available only in recipe runs",
        );
      }
      const parsed = parseInput(input);
      const generated = await options.generation.generate({
        prompt: parsed.prompt,
        orientation: parsed.orientation,
        taskId: context.taskId,
        ...(context.signal ? { signal: context.signal } : undefined),
      });
      if (generated.images.length === 0) {
        throw new Error("The image model returned no image");
      }
      if (generated.images.length > 8) {
        throw new Error("The image model returned more than 8 images");
      }

      const artifacts: RunImageArtifact[] = [];
      for (const [index, image] of generated.images.entries()) {
        const inspected = inspectImage(image.bytes, image.mediaType);
        const blob = await options.blobs.put(image.bytes);
        try {
          artifacts.push(
            options.artifacts.create({
              runId: context.runId,
              captureKey: `${context.toolCallId ?? crypto.randomUUID()}:${index}`,
              sha256: blob.sha256,
              mediaType: inspected.mediaType,
              byteSize: blob.byteSize,
              ...(inspected.width === undefined
                ? {}
                : { width: inspected.width }),
              ...(inspected.height === undefined
                ? {}
                : { height: inspected.height }),
              title: parsed.title,
              alt: parsed.alt,
              providerId: generated.providerId,
              modelId: generated.modelId,
            }),
          );
        } catch (error) {
          if (options.artifacts.referenceCount(blob.sha256) === 0) {
            await options.blobs.delete(blob.sha256).catch(() => undefined);
          }
          throw error;
        }
      }

      const references = artifacts.map(toRunResultImageArtifact);
      return {
        content: [
          `Generated and saved ${references.length} ${references.length === 1 ? "image" : "images"}.`,
        ],
        structuredContent: {
          artifacts: references,
          imageCount: references.length,
        },
        usage: {
          operation: "image_generation",
          provider: generated.providerId,
          modelId: generated.modelId,
          billing: generated.billing ?? "unknown",
          imageCount: references.length,
          ...(generated.inputTokens === undefined
            ? {}
            : { inputTokens: generated.inputTokens }),
          ...(generated.outputTokens === undefined
            ? {}
            : { outputTokens: generated.outputTokens }),
          ...(generated.totalTokens === undefined
            ? {}
            : { totalTokens: generated.totalTokens }),
          ...(generated.costUsdMicros === undefined
            ? {}
            : { costUsdMicros: generated.costUsdMicros }),
          ...(generated.actualCostUsdMicros === undefined
            ? {}
            : { actualCostUsdMicros: generated.actualCostUsdMicros }),
          ...(generated.estimatedCostUsdMicros === undefined
            ? {}
            : { estimatedCostUsdMicros: generated.estimatedCostUsdMicros }),
          ...(generated.costSource === undefined
            ? {}
            : { costSource: generated.costSource }),
        },
      };
    },
  };

  return createNativeToolSource(imageGenerationSourceId, [generateImageTool]);
}

interface ParsedImageInput {
  readonly prompt: string;
  readonly orientation: ImageOrientation;
  readonly title: string;
  readonly alt: string;
}

function parseInput(input: JsonObject): ParsedImageInput {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 32_000) {
    throw new TypeError("prompt must contain between 1 and 32,000 characters");
  }
  const orientation = input.orientation ?? "square";
  if (
    typeof orientation !== "string" ||
    !imageOrientations.includes(orientation as ImageOrientation)
  ) {
    throw new TypeError("orientation must be square, landscape, or portrait");
  }
  const title = optionalText(input.title, "title", 200) ?? "Generated image";
  const alt = optionalText(input.alt, "alt", 1_000) ?? title;
  return {
    prompt,
    orientation: orientation as ImageOrientation,
    title,
    alt,
  };
}

function optionalText(
  value: JsonValue | undefined,
  name: string,
  maximumLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new TypeError(
      `${name} must contain between 1 and ${maximumLength.toLocaleString()} characters`,
    );
  }
  return normalized;
}

function inspectImage(
  bytes: Uint8Array,
  declaredMediaType: string,
): {
  readonly mediaType: ImageArtifactMediaType;
  readonly width?: number;
  readonly height?: number;
} {
  const actualMediaType = sniffImageMediaType(bytes);
  if (!actualMediaType || actualMediaType !== declaredMediaType) {
    throw new TypeError(
      `Generated image bytes do not match ${declaredMediaType || "the declared media type"}`,
    );
  }
  if (
    actualMediaType === "image/png" &&
    bytes.byteLength >= 24 &&
    ascii(bytes, 12, 16) === "IHDR"
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0) {
      return { mediaType: actualMediaType, width, height };
    }
  }
  return { mediaType: actualMediaType };
}

function sniffImageMediaType(
  bytes: Uint8Array,
): ImageArtifactMediaType | undefined {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
