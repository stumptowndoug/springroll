import { and, asc, count, eq } from "drizzle-orm";
import type { RunResultArtifact } from "../contracts.ts";
import type { AppDatabase } from "./database.ts";
import { artifacts, chatTurns } from "./schema.ts";

const sha256Pattern = /^[a-f0-9]{64}$/;
const imageMediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export type ImageArtifactMediaType = (typeof imageMediaTypes)[number];
export type ImageArtifactOrigin = "generated" | "attachment";

export type ArtifactOwner =
  | { readonly kind: "run"; readonly id: string }
  | { readonly kind: "chat_turn"; readonly id: string };

export interface ImageArtifact {
  readonly id: string;
  readonly owner: ArtifactOwner;
  readonly captureKey: string;
  readonly origin: ImageArtifactOrigin;
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

export interface CreateImageArtifactInput {
  readonly id?: string;
  readonly owner: ArtifactOwner;
  readonly captureKey: string;
  readonly origin?: ImageArtifactOrigin;
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

  constructor(owner: ArtifactOwner, captureKey: string) {
    super(
      `Artifact capture ${captureKey} for ${owner.kind} ${owner.id} already refers to different bytes`,
    );
  }
}

export class SqliteArtifactRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateImageArtifactInput, now = new Date()): ImageArtifact {
    validateInput(input);
    const id = input.id ?? crypto.randomUUID();
    this.db
      .insert(artifacts)
      .values({
        id,
        ...(input.owner.kind === "run"
          ? { runId: input.owner.id }
          : { chatTurnId: input.owner.id }),
        captureKey: input.captureKey,
        origin: input.origin ?? "generated",
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
        target:
          input.owner.kind === "run"
            ? [artifacts.runId, artifacts.captureKey]
            : [artifacts.chatTurnId, artifacts.captureKey],
      })
      .run();

    const artifact = this.getByCaptureKey(input.owner, input.captureKey);
    if (!artifact) {
      throw new Error("Artifact metadata was not persisted");
    }
    if (
      artifact.sha256 !== input.sha256 ||
      artifact.mediaType !== input.mediaType ||
      artifact.byteSize !== input.byteSize
    ) {
      throw new ArtifactCaptureConflictError(input.owner, input.captureKey);
    }
    return artifact;
  }

  get(id: string): ImageArtifact | undefined {
    const row = this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id))
      .get();
    return row ? toArtifact(row) : undefined;
  }

  getInScope(id: string, owner: ArtifactOwner): ImageArtifact | undefined {
    const artifact = this.get(id);
    if (!artifact) return undefined;
    if (owner.kind === "run") {
      return artifact.owner.kind === "run" && artifact.owner.id === owner.id
        ? artifact
        : undefined;
    }
    if (artifact.owner.kind !== "chat_turn") return undefined;
    const targetTurn = this.db
      .select({ sessionId: chatTurns.sessionId })
      .from(chatTurns)
      .where(eq(chatTurns.id, owner.id))
      .get();
    if (!targetTurn) return undefined;
    const sourceTurn = this.db
      .select({ sessionId: chatTurns.sessionId })
      .from(chatTurns)
      .where(eq(chatTurns.id, artifact.owner.id))
      .get();
    return sourceTurn?.sessionId === targetTurn.sessionId
      ? artifact
      : undefined;
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.db.delete(artifacts).where(eq(artifacts.id, id)).run();
    return true;
  }

  list(owner: ArtifactOwner): readonly ImageArtifact[] {
    return this.db
      .select()
      .from(artifacts)
      .where(ownerCondition(owner))
      .orderBy(asc(artifacts.createdAt), asc(artifacts.id))
      .all()
      .map(toArtifact);
  }

  listForRun(runId: string): readonly ImageArtifact[] {
    return this.list({ kind: "run", id: runId });
  }

  listForChatTurn(turnId: string): readonly ImageArtifact[] {
    return this.list({ kind: "chat_turn", id: turnId });
  }

  listForChatSession(sessionId: string): readonly ImageArtifact[] {
    return this.db
      .select({ artifact: artifacts })
      .from(artifacts)
      .innerJoin(chatTurns, eq(artifacts.chatTurnId, chatTurns.id))
      .where(eq(chatTurns.sessionId, sessionId))
      .orderBy(asc(artifacts.createdAt), asc(artifacts.id))
      .all()
      .map(({ artifact }) => toArtifact(artifact));
  }

  referenceCount(sha256: string): number {
    if (!sha256Pattern.test(sha256)) return 0;
    return (
      this.db
        .select({ value: count() })
        .from(artifacts)
        .where(eq(artifacts.sha256, sha256))
        .get()?.value ?? 0
    );
  }

  private getByCaptureKey(
    owner: ArtifactOwner,
    captureKey: string,
  ): ImageArtifact | undefined {
    const row = this.db
      .select()
      .from(artifacts)
      .where(and(ownerCondition(owner), eq(artifacts.captureKey, captureKey)))
      .get();
    return row ? toArtifact(row) : undefined;
  }
}

export function toRunResultImageArtifact(
  artifact: ImageArtifact,
): RunResultArtifact {
  return {
    id: artifact.id,
    kind: "image",
    title: artifact.title,
    mediaType: artifact.mediaType,
    payload: {
      sha256: artifact.sha256,
      byteSize: artifact.byteSize,
      origin: artifact.origin,
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

function validateInput(input: CreateImageArtifactInput): void {
  if (!input.owner.id.trim()) throw new TypeError("owner id must not be empty");
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

function ownerCondition(owner: ArtifactOwner) {
  return owner.kind === "run"
    ? eq(artifacts.runId, owner.id)
    : eq(artifacts.chatTurnId, owner.id);
}

function toArtifact(row: typeof artifacts.$inferSelect): ImageArtifact {
  const owner: ArtifactOwner = row.runId
    ? { kind: "run", id: row.runId }
    : row.chatTurnId
      ? { kind: "chat_turn", id: row.chatTurnId }
      : (() => {
          throw new Error(`Artifact ${row.id} has no owner`);
        })();
  return {
    id: row.id,
    owner,
    captureKey: row.captureKey,
    origin: row.origin,
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

/** @deprecated Use SqliteArtifactRepository. */
export { SqliteArtifactRepository as SqliteRunArtifactRepository };
/** @deprecated Use ImageArtifact. */
export type RunImageArtifact = ImageArtifact;
/** @deprecated Use CreateImageArtifactInput. */
export type CreateRunImageArtifactInput = CreateImageArtifactInput;
