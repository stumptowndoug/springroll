import { and, asc, count, eq } from "drizzle-orm";
import type { RunResultArtifact } from "../contracts.ts";
import type { AppDatabase } from "./database.ts";
import { runArtifacts } from "./schema.ts";

const sha256Pattern = /^[a-f0-9]{64}$/;
const imageMediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export type ImageArtifactMediaType = (typeof imageMediaTypes)[number];

export interface RunImageArtifact {
  readonly id: string;
  readonly runId: string;
  readonly captureKey: string;
  readonly sha256: string;
  readonly mediaType: ImageArtifactMediaType;
  readonly byteSize: number;
  readonly width?: number;
  readonly height?: number;
  readonly title: string;
  readonly alt?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly createdAt: Date;
}

export interface CreateRunImageArtifactInput {
  readonly id?: string;
  readonly runId: string;
  readonly captureKey: string;
  readonly sha256: string;
  readonly mediaType: ImageArtifactMediaType;
  readonly byteSize: number;
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  readonly alt?: string;
  readonly providerId?: string;
  readonly modelId?: string;
}

export class ArtifactCaptureConflictError extends Error {
  override readonly name = "ArtifactCaptureConflictError";

  constructor(runId: string, captureKey: string) {
    super(
      `Artifact capture ${captureKey} for run ${runId} already refers to different bytes`,
    );
  }
}

export class SqliteRunArtifactRepository {
  constructor(private readonly db: AppDatabase) {}

  create(
    input: CreateRunImageArtifactInput,
    now = new Date(),
  ): RunImageArtifact {
    validateInput(input);
    const id = input.id ?? crypto.randomUUID();
    this.db
      .insert(runArtifacts)
      .values({
        id,
        runId: input.runId,
        captureKey: input.captureKey,
        sha256: input.sha256,
        mediaType: input.mediaType,
        byteSize: input.byteSize,
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        title: input.title ?? "Generated image",
        ...(input.alt === undefined ? {} : { alt: input.alt }),
        ...(input.providerId === undefined
          ? {}
          : { providerId: input.providerId }),
        ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [runArtifacts.runId, runArtifacts.captureKey],
      })
      .run();

    const artifact = this.getByCaptureKey(input.runId, input.captureKey);
    if (!artifact) {
      throw new Error("Artifact metadata was not persisted");
    }
    if (
      artifact.sha256 !== input.sha256 ||
      artifact.mediaType !== input.mediaType ||
      artifact.byteSize !== input.byteSize
    ) {
      throw new ArtifactCaptureConflictError(input.runId, input.captureKey);
    }
    return artifact;
  }

  get(id: string): RunImageArtifact | undefined {
    const row = this.db
      .select()
      .from(runArtifacts)
      .where(eq(runArtifacts.id, id))
      .get();
    return row ? toArtifact(row) : undefined;
  }

  listForRun(runId: string): readonly RunImageArtifact[] {
    return this.db
      .select()
      .from(runArtifacts)
      .where(eq(runArtifacts.runId, runId))
      .orderBy(asc(runArtifacts.createdAt), asc(runArtifacts.id))
      .all()
      .map(toArtifact);
  }

  referenceCount(sha256: string): number {
    if (!sha256Pattern.test(sha256)) return 0;
    return (
      this.db
        .select({ value: count() })
        .from(runArtifacts)
        .where(eq(runArtifacts.sha256, sha256))
        .get()?.value ?? 0
    );
  }

  private getByCaptureKey(
    runId: string,
    captureKey: string,
  ): RunImageArtifact | undefined {
    const row = this.db
      .select()
      .from(runArtifacts)
      .where(
        and(
          eq(runArtifacts.runId, runId),
          eq(runArtifacts.captureKey, captureKey),
        ),
      )
      .get();
    return row ? toArtifact(row) : undefined;
  }
}

export function toRunResultImageArtifact(
  artifact: RunImageArtifact,
): RunResultArtifact {
  return {
    id: artifact.id,
    kind: "image",
    title: artifact.title,
    mediaType: artifact.mediaType,
    payload: {
      sha256: artifact.sha256,
      byteSize: artifact.byteSize,
      ...(artifact.width === undefined ? {} : { width: artifact.width }),
      ...(artifact.height === undefined ? {} : { height: artifact.height }),
      ...(artifact.alt === undefined ? {} : { alt: artifact.alt }),
      ...(artifact.providerId === undefined
        ? {}
        : { providerId: artifact.providerId }),
      ...(artifact.modelId === undefined ? {} : { modelId: artifact.modelId }),
    },
  };
}

function validateInput(input: CreateRunImageArtifactInput): void {
  if (!input.runId.trim()) throw new TypeError("runId must not be empty");
  if (!input.captureKey.trim()) {
    throw new TypeError("captureKey must not be empty");
  }
  if (!sha256Pattern.test(input.sha256)) {
    throw new TypeError("sha256 must be a lowercase SHA-256 digest");
  }
  if (!imageMediaTypes.includes(input.mediaType)) {
    throw new TypeError(`Unsupported image media type: ${input.mediaType}`);
  }
  positiveInteger(input.byteSize, "byteSize");
  if (input.width !== undefined) positiveInteger(input.width, "width");
  if (input.height !== undefined) positiveInteger(input.height, "height");
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function toArtifact(row: typeof runArtifacts.$inferSelect): RunImageArtifact {
  return {
    id: row.id,
    runId: row.runId,
    captureKey: row.captureKey,
    sha256: row.sha256,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    title: row.title,
    ...(row.alt === null ? {} : { alt: row.alt }),
    ...(row.providerId === null ? {} : { providerId: row.providerId }),
    ...(row.modelId === null ? {} : { modelId: row.modelId }),
    createdAt: row.createdAt,
  };
}
