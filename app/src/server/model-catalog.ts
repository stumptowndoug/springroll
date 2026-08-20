import { Database } from "bun:sqlite";
import type { ModelOptionDto, ModelProviderId } from "../shared.ts";
import {
  colorizeProviderLogo,
  providerLogoSeeds,
  sanitizeProviderLogo,
} from "./provider-logos.ts";

interface ModelsDevModel {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly reasoning?: unknown;
  readonly tool_call?: unknown;
  readonly modalities?: {
    readonly input?: unknown;
    readonly output?: unknown;
  };
  readonly limit?: {
    readonly context?: unknown;
  };
  readonly cost?: {
    readonly input?: unknown;
    readonly output?: unknown;
  };
}

interface OpenRouterImageModel {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly architecture?: {
    readonly input_modalities?: unknown;
    readonly output_modalities?: unknown;
  };
  readonly supported_parameters?: unknown;
}

interface CacheRow {
  readonly etag: string | null;
  readonly payload: string;
  readonly fetched_at: number;
}

export interface ModelCatalogSnapshot {
  readonly models: readonly ModelOptionDto[];
  readonly imageModels: readonly ModelOptionDto[];
  readonly updatedAt?: Date;
  readonly revision?: string;
  readonly stale: boolean;
}

type FetchApi = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

const modelsDevEndpoint = "https://models.dev/api.json";
const modelsDevCacheKey = "models.dev/api.json";
const openRouterImageEndpoint = "https://openrouter.ai/api/v1/images/models";
const openRouterImageCacheKey = "openrouter.ai/api/v1/images/models";
const logoKey = (providerId: ModelProviderId) =>
  `models.dev/logos/${providerId}.svg`;
const logoEndpoint = (providerId: ModelProviderId) =>
  `https://models.dev/logos/${providerId}.svg`;
const refreshAfterMs = 6 * 60 * 60 * 1_000;
const supportedProviders: readonly ModelProviderId[] = [
  "openrouter",
  "openai",
  "xai",
];

export class SpringrollModelCatalog {
  readonly #cache: Database;
  readonly #fetch: FetchApi;
  readonly #now: () => Date;

  constructor(
    cacheFilename: string,
    options: {
      readonly fetch?: FetchApi;
      readonly now?: () => Date;
    } = {},
  ) {
    this.#cache = new Database(cacheFilename, { create: true });
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
    this.#cache.run("PRAGMA journal_mode = WAL");
    this.#cache.run(`
      CREATE TABLE IF NOT EXISTS model_catalog_cache (
        key TEXT PRIMARY KEY,
        etag TEXT,
        payload TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      )
    `);
  }

  async read(
    options: { readonly force?: boolean } = {},
  ): Promise<ModelCatalogSnapshot> {
    const [modelsDev, openRouterImages] = await Promise.all([
      this.#readJsonSource(
        modelsDevCacheKey,
        modelsDevEndpoint,
        parseModelsDevCatalog,
        options.force === true,
      ),
      this.#readJsonSource(
        openRouterImageCacheKey,
        openRouterImageEndpoint,
        parseOpenRouterImageCatalog,
        options.force === true,
      ).catch(() => undefined),
    ]);
    const catalog = normalizeCatalog(
      parseModelsDevCatalog(modelsDev.row.payload),
    );
    const imageModels = openRouterImages
      ? sortModels([
          ...catalog.imageModels.filter(
            (model) => model.providerId !== "openrouter",
          ),
          ...normalizeOpenRouterImageCatalog(
            parseOpenRouterImageCatalog(openRouterImages.row.payload),
          ),
        ])
      : catalog.imageModels;
    const sources = [modelsDev, openRouterImages].filter(
      (source): source is { readonly row: CacheRow; readonly stale: boolean } =>
        source !== undefined,
    );

    return {
      models: catalog.models,
      imageModels,
      updatedAt: new Date(
        Math.min(...sources.map((source) => source.row.fetched_at)),
      ),
      revision: sources
        .map(
          (source) =>
            source.row.etag ?? new Date(source.row.fetched_at).toISOString(),
        )
        .join("+"),
      stale:
        openRouterImages === undefined ||
        sources.some((source) => source.stale),
    };
  }

  async #readJsonSource<T>(
    key: string,
    sourceEndpoint: string,
    parse: (payload: string) => T,
    force: boolean,
  ): Promise<{ readonly row: CacheRow; readonly stale: boolean }> {
    const cached = this.#readCache(key);
    const now = this.#now();
    if (
      cached &&
      !force &&
      now.getTime() - cached.fetched_at < refreshAfterMs
    ) {
      return { row: cached, stale: false };
    }

    try {
      const response = await this.#fetch(sourceEndpoint, {
        headers: {
          accept: "application/json",
          ...(cached?.etag ? { "if-none-match": cached.etag } : undefined),
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 304 && cached) {
        const refreshed = {
          ...cached,
          fetched_at: now.getTime(),
        };
        this.#writeCache(key, refreshed);
        return { row: refreshed, stale: false };
      }
      if (!response.ok) {
        throw new Error(`${sourceEndpoint} returned HTTP ${response.status}`);
      }

      const payload = await response.text();
      parse(payload);
      const fresh = {
        etag: response.headers.get("etag"),
        payload,
        fetched_at: now.getTime(),
      };
      this.#writeCache(key, fresh);
      return { row: fresh, stale: false };
    } catch (error) {
      if (cached) {
        return { row: cached, stale: true };
      }
      throw new Error(
        `The model catalog source is unavailable: ${errorMessage(error)}`,
      );
    }
  }

  /*
   * Provider marks from the same host, cached alongside the catalog with
   * the vendored copies as fallback: a failed or first-run-offline fetch
   * still yields a logo, and a poisoned payload falls back to the seed.
   */
  async logos(): Promise<Record<ModelProviderId, string>> {
    const entries = await Promise.all(
      supportedProviders.map(async (providerId) => {
        const svg = await this.#logo(providerId);
        return [providerId, svg] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<ModelProviderId, string>;
  }

  async #logo(providerId: ModelProviderId): Promise<string> {
    const key = logoKey(providerId);
    const cached = this.#readCache(key);
    const now = this.#now();
    const cachedSvg = cached && sanitizeProviderLogo(cached.payload);
    if (cachedSvg && now.getTime() - cached.fetched_at < refreshAfterMs) {
      return colorizeProviderLogo(providerId, cachedSvg);
    }

    try {
      const response = await this.#fetch(logoEndpoint(providerId), {
        headers: {
          accept: "image/svg+xml",
          ...(cached?.etag ? { "if-none-match": cached.etag } : undefined),
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 304 && cachedSvg) {
        this.#writeCache(key, { ...cached, fetched_at: now.getTime() });
        return colorizeProviderLogo(providerId, cachedSvg);
      }
      if (!response.ok) {
        throw new Error(`models.dev returned HTTP ${response.status}`);
      }
      const svg = sanitizeProviderLogo(await response.text());
      if (!svg) {
        throw new TypeError("models.dev returned an invalid logo");
      }
      this.#writeCache(key, {
        etag: response.headers.get("etag"),
        payload: svg,
        fetched_at: now.getTime(),
      });
      return colorizeProviderLogo(providerId, svg);
    } catch {
      return cachedSvg
        ? colorizeProviderLogo(providerId, cachedSvg)
        : providerLogoSeeds[providerId];
    }
  }

  close(): void {
    this.#cache.close();
  }

  #readCache(key: string): CacheRow | undefined {
    return (
      this.#cache
        .query<CacheRow, [string]>(
          "SELECT etag, payload, fetched_at FROM model_catalog_cache WHERE key = ?",
        )
        .get(key) ?? undefined
    );
  }

  #writeCache(key: string, row: CacheRow): void {
    this.#cache
      .query(
        `INSERT INTO model_catalog_cache (key, etag, payload, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           etag = excluded.etag,
           payload = excluded.payload,
           fetched_at = excluded.fetched_at`,
      )
      .run(key, row.etag, row.payload, row.fetched_at);
  }
}

function parseModelsDevCatalog(payload: string): Record<string, unknown> {
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("models.dev returned an invalid catalog");
  }
  return parsed as Record<string, unknown>;
}

function parseOpenRouterImageCatalog(payload: string): readonly unknown[] {
  const parsed = JSON.parse(payload) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("data" in parsed) ||
    !Array.isArray(parsed.data)
  ) {
    throw new TypeError("OpenRouter returned an invalid image model catalog");
  }
  return parsed.data;
}

function normalizeCatalog(
  catalog: Record<string, unknown>,
): Pick<ModelCatalogSnapshot, "models" | "imageModels"> {
  const models: ModelOptionDto[] = [];
  const imageModels: ModelOptionDto[] = [];

  for (const providerId of supportedProviders) {
    const provider = catalog[providerId];
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
      continue;
    }
    const rawModels = (provider as { readonly models?: unknown }).models;
    if (
      !rawModels ||
      typeof rawModels !== "object" ||
      Array.isArray(rawModels)
    ) {
      continue;
    }

    for (const [catalogId, value] of Object.entries(rawModels)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const model = value as ModelsDevModel;
      const output = stringArray(model.modalities?.output);
      const isLanguageModel =
        model.tool_call === true && output.includes("text");
      const isImageModel = output.includes("image");
      if (!isLanguageModel && !isImageModel) {
        continue;
      }
      const modelId =
        typeof model.id === "string" && model.id ? model.id : catalogId;
      const option: ModelOptionDto = {
        providerId,
        modelId,
        name:
          typeof model.name === "string" && model.name ? model.name : modelId,
        ...(typeof model.description === "string" && model.description
          ? { description: model.description }
          : undefined),
        ...(finitePositive(model.limit?.context)
          ? { contextTokens: model.limit.context }
          : undefined),
        ...(finiteNonNegative(model.cost?.input)
          ? { inputUsdPerMillionTokens: model.cost.input }
          : undefined),
        ...(finiteNonNegative(model.cost?.output)
          ? { outputUsdPerMillionTokens: model.cost.output }
          : undefined),
        reasoning: model.reasoning === true,
        toolCall: model.tool_call === true,
        inputModalities: stringArray(model.modalities?.input),
      };
      if (isLanguageModel) models.push(option);
      if (isImageModel) imageModels.push(option);
    }
  }

  return {
    models: sortModels(models),
    imageModels: sortModels(imageModels),
  };
}

function normalizeOpenRouterImageCatalog(
  models: readonly unknown[],
): readonly ModelOptionDto[] {
  const normalized: ModelOptionDto[] = [];
  for (const value of models) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const model = value as OpenRouterImageModel;
    if (typeof model.id !== "string" || model.id.trim() === "") continue;
    const output = stringArray(model.architecture?.output_modalities);
    if (
      !output.includes("image") ||
      !supportsAspectRatio(model) ||
      !supportsRasterOutput(model)
    ) {
      continue;
    }
    normalized.push({
      providerId: "openrouter",
      modelId: model.id,
      name:
        typeof model.name === "string" && model.name ? model.name : model.id,
      ...(typeof model.description === "string" && model.description
        ? { description: model.description }
        : undefined),
      reasoning: false,
      toolCall: false,
      inputModalities: stringArray(model.architecture?.input_modalities),
    });
  }
  return normalized;
}

function supportsAspectRatio(model: OpenRouterImageModel): boolean {
  return (
    model.supported_parameters !== null &&
    typeof model.supported_parameters === "object" &&
    !Array.isArray(model.supported_parameters) &&
    "aspect_ratio" in model.supported_parameters
  );
}

function supportsRasterOutput(model: OpenRouterImageModel): boolean {
  if (
    model.supported_parameters === null ||
    typeof model.supported_parameters !== "object" ||
    Array.isArray(model.supported_parameters) ||
    !("output_format" in model.supported_parameters)
  ) {
    return true;
  }
  const descriptor = model.supported_parameters.output_format;
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor) ||
    !("values" in descriptor) ||
    !Array.isArray(descriptor.values)
  ) {
    return true;
  }
  return descriptor.values.some(
    (value) =>
      typeof value === "string" &&
      ["png", "jpeg", "jpg", "webp"].includes(value.toLowerCase()),
  );
}

function sortModels(models: ModelOptionDto[]): readonly ModelOptionDto[] {
  return models.sort(
    (left, right) =>
      left.providerId.localeCompare(right.providerId) ||
      left.name.localeCompare(right.name),
  );
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
