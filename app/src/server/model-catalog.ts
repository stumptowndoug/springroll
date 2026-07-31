import { Database } from "bun:sqlite";
import type { ModelOptionDto, ModelProviderId } from "../shared.ts";

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

interface CacheRow {
  readonly etag: string | null;
  readonly payload: string;
  readonly fetched_at: number;
}

export interface ModelCatalogSnapshot {
  readonly models: readonly ModelOptionDto[];
  readonly updatedAt?: Date;
  readonly revision?: string;
  readonly stale: boolean;
}

type FetchApi = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

const endpoint = "https://models.dev/api.json";
const cacheKey = "models.dev/api.json";
const refreshAfterMs = 6 * 60 * 60 * 1_000;
const supportedProviders: readonly ModelProviderId[] = [
  "openrouter",
  "openai",
  "xai",
];

export class ModelsDevCatalog {
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

  async read(): Promise<ModelCatalogSnapshot> {
    const cached = this.#readCache();
    const now = this.#now();
    if (cached && now.getTime() - cached.fetched_at < refreshAfterMs) {
      return this.#snapshot(cached, false);
    }

    try {
      const response = await this.#fetch(endpoint, {
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
        this.#writeCache(refreshed);
        return this.#snapshot(refreshed, false);
      }
      if (!response.ok) {
        throw new Error(`models.dev returned HTTP ${response.status}`);
      }

      const payload = await response.text();
      parseCatalog(payload);
      const fresh = {
        etag: response.headers.get("etag"),
        payload,
        fetched_at: now.getTime(),
      };
      this.#writeCache(fresh);
      return this.#snapshot(fresh, false);
    } catch (error) {
      if (cached) {
        return this.#snapshot(cached, true);
      }
      throw new Error(
        `The model catalog is unavailable: ${errorMessage(error)}`,
      );
    }
  }

  close(): void {
    this.#cache.close();
  }

  #readCache(): CacheRow | undefined {
    return (
      this.#cache
        .query<CacheRow, [string]>(
          "SELECT etag, payload, fetched_at FROM model_catalog_cache WHERE key = ?",
        )
        .get(cacheKey) ?? undefined
    );
  }

  #writeCache(row: CacheRow): void {
    this.#cache
      .query(
        `INSERT INTO model_catalog_cache (key, etag, payload, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           etag = excluded.etag,
           payload = excluded.payload,
           fetched_at = excluded.fetched_at`,
      )
      .run(cacheKey, row.etag, row.payload, row.fetched_at);
  }

  #snapshot(row: CacheRow, stale: boolean): ModelCatalogSnapshot {
    return {
      models: normalizeCatalog(parseCatalog(row.payload)),
      updatedAt: new Date(row.fetched_at),
      revision: row.etag ?? new Date(row.fetched_at).toISOString(),
      stale,
    };
  }
}

function parseCatalog(payload: string): Record<string, unknown> {
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("models.dev returned an invalid catalog");
  }
  return parsed as Record<string, unknown>;
}

function normalizeCatalog(
  catalog: Record<string, unknown>,
): readonly ModelOptionDto[] {
  const models: ModelOptionDto[] = [];

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
      if (model.tool_call !== true || !output.includes("text")) {
        continue;
      }
      const modelId =
        typeof model.id === "string" && model.id ? model.id : catalogId;
      models.push({
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
        toolCall: true,
        inputModalities: stringArray(model.modalities?.input),
      });
    }
  }

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
