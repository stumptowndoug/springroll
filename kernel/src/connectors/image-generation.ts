import { inspectImage } from "../image-file.ts";
import {
  type ImageGenerationModelOption,
  type ImageGenerationToolRuntime,
  type ImageOrientation,
  imageOrientations,
} from "../image-generation.ts";
import type { ArtifactBlobStore } from "../storage/artifact-blob-store.ts";
import {
  type ImageArtifact,
  type SqliteArtifactRepository,
  toRunResultImageArtifact,
} from "../storage/sqlite-run-artifact-repository.ts";
import {
  type JsonObject,
  type JsonValue,
  type ToolCallContext,
  type ToolDescriptor,
  ToolPolicyError,
  type ToolResult,
  type ToolSource,
} from "../tools.ts";

export const imageGenerationSourceId = "native.image-generation";
export const imageGenerationConnectionId = "builtin-image-generation";
export const imageGenerationCredentialRef = "image-generation-model";
export const imageGenerationCardId = "image-generation";
export const imageGenerationToolInputSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "A complete visual description of the image to create.",
      minLength: 1,
      maxLength: 32_000,
    },
    model: {
      type: "string",
      description:
        "Optional connected image-model handle from this tool's description.",
      minLength: 1,
      maxLength: 500,
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
    referenceArtifactIds: {
      type: "array",
      description:
        "Optional image artifact IDs from this conversation or run to use as visual references.",
      items: { type: "string", minLength: 1, maxLength: 200 },
      maxItems: 4,
      uniqueItems: true,
    },
  },
  required: ["prompt"],
  additionalProperties: false,
} as const;

export interface ImageGenerationToolSourceOptions {
  readonly generation: ImageGenerationToolRuntime;
  readonly blobs: ArtifactBlobStore;
  readonly artifacts: SqliteArtifactRepository;
}

export function createImageGenerationToolSource(
  options: ImageGenerationToolSourceOptions,
): ToolSource {
  const execute = async (
    input: JsonObject,
    context: ToolCallContext,
  ): Promise<ToolResult> => {
    const parsed = parseInput(input);
    const artifactOwner = context.artifactOwner ?? {
      kind: "run" as const,
      id: context.runId,
    };
    const referenceImages = await Promise.all(
      parsed.referenceArtifactIds.map(async (id) => {
        const artifact = options.artifacts.getInScope(id, artifactOwner);
        if (!artifact) {
          throw new TypeError(
            `Reference image is unavailable in this conversation or run: ${id}`,
          );
        }
        const bytes = await options.blobs.get(artifact.sha256);
        if (!bytes)
          throw new Error(`Reference image data is unavailable: ${id}`);
        return { bytes, mediaType: artifact.mediaType };
      }),
    );
    const generated = await options.generation.generate({
      prompt: parsed.prompt,
      orientation: parsed.orientation,
      ...(referenceImages.length ? { references: referenceImages } : undefined),
      ...(parsed.model ? { model: parsed.model } : undefined),
      taskId: context.taskId,
      ...(context.signal ? { signal: context.signal } : undefined),
    });
    if (generated.images.length === 0) {
      throw new Error("The image model returned no image");
    }
    if (generated.images.length > 8) {
      throw new Error("The image model returned more than 8 images");
    }

    const artifacts: ImageArtifact[] = [];
    for (const [index, image] of generated.images.entries()) {
      const inspected = inspectImage(image.bytes, image.mediaType);
      const blob = await options.blobs.put(image.bytes);
      try {
        artifacts.push(
          options.artifacts.create({
            owner: artifactOwner,
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
  };

  return {
    id: imageGenerationSourceId,
    kind: "native",
    async open() {
      return {
        async listTools() {
          return [
            imageGenerationToolDescriptor(
              await options.generation.listModels(),
            ),
          ];
        },
        async callTool(name, input, context) {
          if (name !== "generate_image") {
            throw new ToolPolicyError(
              `Unknown native tool: ${imageGenerationSourceId}/${name}`,
            );
          }
          return execute(input, context);
        },
        async close() {},
      };
    },
  };
}

export function imageGenerationToolDescriptor(
  models: readonly ImageGenerationModelOption[],
): ToolDescriptor {
  const choices = models
    .map(
      (model) =>
        `${model.handle}${model.inputModalities?.includes("image") ? " (accepts references)" : ""}`,
    )
    .join(", ");
  return {
    name: "generate_image",
    description: [
      "Generate one image and save it to the current response.",
      "Call once per image; independent calls can run in parallel.",
      "Set model to a connected image-model handle, or omit it to use the recipe or app default.",
      "When the user supplies or refers to an existing image, pass its artifact ID in referenceArtifactIds; support depends on the selected model.",
      models.length
        ? `Available model handles: ${choices}.`
        : "No connected image models are currently available.",
      "To place the image within the final Markdown, put {{artifact:ARTIFACT_ID}} on its own line using the id returned by this tool.",
    ].join(" "),
    inputSchema: imageGenerationToolInputSchema,
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
  };
}

interface ParsedImageInput {
  readonly prompt: string;
  readonly model?: string;
  readonly orientation: ImageOrientation;
  readonly title: string;
  readonly alt: string;
  readonly referenceArtifactIds: readonly string[];
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
  const model = optionalText(input.model, "model", 500);
  const referenceArtifactIds = optionalStringArray(
    input.referenceArtifactIds,
    "referenceArtifactIds",
    4,
  );
  return {
    prompt,
    ...(model ? { model } : undefined),
    orientation: orientation as ImageOrientation,
    title,
    alt,
    referenceArtifactIds,
  };
}

function optionalStringArray(
  value: JsonValue | undefined,
  name: string,
  maximumItems: number,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${name} must contain at most ${maximumItems} strings`);
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 200) {
      throw new TypeError(`${name} must contain non-empty strings`);
    }
    return item.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${name} must not contain duplicates`);
  }
  return normalized;
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
