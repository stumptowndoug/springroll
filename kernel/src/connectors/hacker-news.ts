import {
  HttpStatusError,
  InvalidResponseError,
  type RetryOptions,
  withRetry,
} from "../failures.ts";
import {
  createNativeToolSource,
  type JsonObject,
  type NativeTool,
  type ToolSource,
} from "../tools.ts";

const apiOrigin = "https://hacker-news.firebaseio.com";
const topStoriesUrl = `${apiOrigin}/v0/topstories.json`;
const defaultLimit = 10;
const maximumLimit = 30;

export const hackerNewsTopStoriesInputSchema = {
  type: "object",
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: maximumLimit,
      description: "Number of top stories to fetch.",
    },
  },
  additionalProperties: false,
} as const;

export interface HackerNewsConnectorOptions {
  readonly fetch?: FetchJson;
  readonly defaultLimit?: number;
  readonly retry?: RetryOptions;
}

export type FetchJson = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

interface HackerNewsItem {
  readonly id: number;
  readonly by?: string;
  readonly descendants?: number;
  readonly score?: number;
  readonly time?: number;
  readonly title?: string;
  readonly type?: string;
  readonly url?: string;
}

export function createHackerNewsToolSource(
  options: HackerNewsConnectorOptions = {},
): ToolSource {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const configuredDefault = options.defaultLimit ?? defaultLimit;

  if (
    !Number.isInteger(configuredDefault) ||
    configuredDefault < 1 ||
    configuredDefault > maximumLimit
  ) {
    throw new RangeError(`defaultLimit must be between 1 and ${maximumLimit}`);
  }

  const topStories: NativeTool = {
    descriptor: {
      name: "get_hacker_news_top_stories",
      description:
        "Fetch the current top Hacker News stories from the official Hacker News API.",
      inputSchema: hackerNewsTopStoriesInputSchema,
      outputSchema: {
        type: "object",
        properties: {
          stories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                title: { type: "string" },
                url: { type: "string" },
                by: { type: "string" },
                score: { type: "integer" },
                time: { type: "integer" },
                descendants: { type: "integer" },
              },
              required: ["id", "title"],
            },
          },
        },
        required: ["stories"],
      },
      declaredRisk: {
        effect: "read",
        openWorld: true,
        idempotent: true,
      },
    },
    async execute(input) {
      const limit = readLimit(input, configuredDefault);
      const storyIds = await fetchJson<unknown>(
        fetchImplementation,
        topStoriesUrl,
        options.retry,
      );

      if (
        !Array.isArray(storyIds) ||
        !storyIds.every((id) => Number.isInteger(id))
      ) {
        throw new InvalidResponseError(
          "Hacker News returned an invalid story list",
        );
      }

      const stories = (
        await Promise.all(
          storyIds
            .slice(0, limit)
            .map((id) =>
              fetchJson<unknown>(
                fetchImplementation,
                `${apiOrigin}/v0/item/${id}.json`,
                options.retry,
              ),
            ),
        )
      )
        .filter(isStory)
        .map(toStory);

      return {
        content: [
          stories.length === 0
            ? "Hacker News returned no top stories."
            : stories
                .map(
                  (story, index) =>
                    `${index + 1}. ${story.title} (${story.score ?? 0} points)`,
                )
                .join("\n"),
        ],
        structuredContent: { stories },
      };
    },
  };

  return createNativeToolSource("native.hacker-news", [topStories]);
}

function readLimit(input: JsonObject, fallback: number): number {
  const limit = input.limit ?? fallback;

  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximumLimit
  ) {
    throw new RangeError(`limit must be between 1 and ${maximumLimit}`);
  }

  return limit;
}

async function fetchJson<T>(
  fetchImplementation: FetchJson,
  url: string,
  retry: RetryOptions | undefined,
): Promise<T> {
  return withRetry(async () => {
    const response = await fetchImplementation(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new HttpStatusError(
        response.status,
        `Hacker News request failed with HTTP ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }, retry);
}

function isStory(value: unknown): value is HackerNewsItem {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<HackerNewsItem>;
  return (
    Number.isInteger(item.id) &&
    item.type === "story" &&
    typeof item.title === "string"
  );
}

function toStory(item: HackerNewsItem): JsonObject {
  return {
    id: item.id,
    title: item.title ?? "",
    ...(item.url ? { url: item.url } : undefined),
    ...(item.by ? { by: item.by } : undefined),
    ...(item.score === undefined ? undefined : { score: item.score }),
    ...(item.time === undefined ? undefined : { time: item.time }),
    ...(item.descendants === undefined
      ? undefined
      : { descendants: item.descendants }),
  };
}
