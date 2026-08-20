# Native Image Generation Plan

Status: in progress on `feat/native-image-generation`.

## Goal

Give a recipe one Springroll-owned `generate_image` tool. The tool uses the AI
SDK's `generateImage()` API, saves the returned bytes as a local artifact, and
returns only a small reference to the agent. The finished run displays the
image inline.

This first implementation generates new images for recipe runs. Image upload,
editing, vision input, and chat images are separate follow-ups.

## User flow

1. The user connects an AI provider and chooses a supported image model in
   Settings.
2. A recipe pins Springroll's Image Generation integration.
3. The agent calls `generate_image` with a prompt and orientation.
4. Springroll calls the configured image model, persists the image, and gives
   the agent an artifact reference instead of image bytes.
5. The run letter displays the artifact.

## Architecture

```text
recipe agent
    -> generate_image({ prompt, orientation })
    -> ImageGenerationService
    -> AI SDK generateImage({ model, prompt, ... })
    -> ArtifactBlobStore (.local/artifacts/<sha256>)
    -> run_artifacts metadata row
    -> compact tool result containing the artifact id
    -> GET /api/artifacts/:id
    -> run letter image
```

MCP is not part of this path. A future shared sanitizer can adopt images
returned by third-party tools, but it does not shape this implementation.

## Decisions

- Use one native tool and one shared AI SDK generation path.
- Keep provider/model selection in Settings. The agent chooses the prompt and
  orientation, not the provider or price tier.
- Maintain a curated `ImageModelDefinition` registry because image-model
  capabilities differ. Start with OpenAI; add OpenRouter next and Google after
  Springroll has a Google model connection.
- Normalize the tool input to `square`, `landscape`, or `portrait`. The model
  definition maps that to provider-supported size or aspect-ratio settings.
- Store bytes on disk once. SQLite, tool results, events, checkpoints, and
  `result_json` contain references only.
- Support PNG, JPEG, and WebP initially. Validate actual bytes and declared
  media type before accepting an artifact. Do not support SVG or GIF in v1.
- Image generation is a paid, non-idempotent write capability and follows the
  existing pinned-tool approval policy.
- Keep v1 local-only. Hosted generation requires a hosted blob-store
  implementation and quota policy.

## Core interfaces

```ts
interface ImageModelDefinition {
  providerId: "openai" | "openrouter";
  modelId: string;
  name: string;
  orientations: readonly ("square" | "landscape" | "portrait")[];
}

interface ImageGenerationService {
  generate(input: {
    prompt: string;
    orientation: "square" | "landscape" | "portrait";
    signal?: AbortSignal;
  }): Promise<GeneratedImage[]>;
}

interface GeneratedImage {
  bytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  providerId: string;
  modelId: string;
  costUsdMicros?: number;
}

interface ArtifactBlobStore {
  put(bytes: Uint8Array): Promise<{ sha256: string; byteSize: number }>;
  get(sha256: string): Promise<Uint8Array | undefined>;
  delete(sha256: string): Promise<void>;
}
```

Blob storage owns bytes only. A separate SQLite repository owns artifact
occurrences:

```text
run_artifacts
  id             text primary key (opaque artifact id)
  run_id         text not null references runs(id) on delete cascade
  capture_key    text not null
  sha256         text not null
  media_type     text not null
  byte_size      integer not null
  width          integer
  height         integer
  provider_id    text
  model_id       text
  created_at     integer not null

unique(run_id, capture_key)
index(sha256)
```

The artifact id identifies a run-owned occurrence. The SHA-256 identifies the
deduplicated file. `capture_key` makes retries and continuations idempotent.

## Implementation order

### 1. Artifact foundation

- Implement and contract-test `FilesystemArtifactBlobStore`.
- Add `run_artifacts` and `SqliteRunArtifactRepository`.
- Add an `image` variant to `RunResultArtifact` without duplicating its
  existing top-level `id` and `mediaType` fields.
- Enforce a 10 MB per-image limit and a configurable total local storage cap.

### 2. Native image tool

- Add an injectable `AiSdkImageGenerationService` around `generateImage()`.
- Add the curated image-model registry and an `image` model setting.
- Add OpenAI image-model loading through `openai.image(modelId)`.
- Add the built-in local-only Image Generation connection and
  `generate_image` tool.
- Save each successful image before returning from the tool. If persistence
  fails, strip the bytes and fail the tool call; never pass bytes to the agent.
- Record provider, model, image count, and cost when the provider reports it.

### 3. Run result and presentation

- Load artifact rows by run id when constructing the final `RunResultV1` so
  approval continuations and restarts retain earlier artifacts.
- Add `GET /api/artifacts/:id`, resolving the occurrence row before reading
  its SHA-addressed blob.
- Return the stored content type with `nosniff`, sandbox CSP, immutable cache
  headers, and an inline disposition.
- Render image artifacts below the run body with constrained dimensions,
  intrinsic width/height, useful alt text, and a quiet missing-file state.
- Keep images out of Markdown rendering.

### 4. Lifecycle and hardening

- Delete unreferenced blobs after run deletion and pruning.
- Refuse new artifacts when the local storage budget is exhausted and surface
  a clear run error.
- Test that known base64 sentinels never appear in run results, events,
  checkpoints, or tool summaries.
- Test cancellation, retries, duplicate bytes, duplicate capture keys,
  missing files, invalid media, and interrupted writes.

### 5. Provider expansion

- Add OpenRouter through `openrouter.imageModel(modelId)` using the same
  service and artifact path.
- Add Google through `google.image(modelId)` once Google credentials and model
  settings exist.
- Add only models whose supported orientations, output formats, limits, and
  pricing can be represented accurately in `ImageModelDefinition`.

## Acceptance

1. A recipe can pin `generate_image` and complete using a configured OpenAI
   image model.
2. The run contains an `image` artifact and displays it inline.
3. Image bytes exist only under `.local/artifacts`; SQLite and events contain
   references, metadata, and usage only.
4. Repeating identical output creates a second run-artifact row but stores one
   blob.
5. Unsupported media, oversized images, exhausted storage, and failed writes
   never leak image bytes into the model loop.
6. Focused tests and `bun run check` pass.
